(function() {
  'use strict';

  var globals = typeof window === 'undefined' ? global : window;
  if (typeof globals.require === 'function') return;

  var modules = {};
  var cache = {};
  var aliases = {};
  var has = ({}).hasOwnProperty;

  var expRe = /^\.\.?(\/|$)/;
  var expand = function(root, name) {
    var results = [], part;
    var parts = (expRe.test(name) ? root + '/' + name : name).split('/');
    for (var i = 0, length = parts.length; i < length; i++) {
      part = parts[i];
      if (part === '..') {
        results.pop();
      } else if (part !== '.' && part !== '') {
        results.push(part);
      }
    }
    return results.join('/');
  };

  var dirname = function(path) {
    return path.split('/').slice(0, -1).join('/');
  };

  var localRequire = function(path) {
    return function expanded(name) {
      var absolute = expand(dirname(path), name);
      return globals.require(absolute, path);
    };
  };

  var initModule = function(name, definition) {
    var hot = null;
    hot = hmr && hmr.createHot(name);
    var module = {id: name, exports: {}, hot: hot};
    cache[name] = module;
    definition(module.exports, localRequire(name), module);
    return module.exports;
  };

  var expandAlias = function(name) {
    return aliases[name] ? expandAlias(aliases[name]) : name;
  };

  var _resolve = function(name, dep) {
    return expandAlias(expand(dirname(name), dep));
  };

  var require = function(name, loaderPath) {
    if (loaderPath == null) loaderPath = '/';
    var path = expandAlias(name);

    if (has.call(cache, path)) return cache[path].exports;
    if (has.call(modules, path)) return initModule(path, modules[path]);

    throw new Error("Cannot find module '" + name + "' from '" + loaderPath + "'");
  };

  require.alias = function(from, to) {
    aliases[to] = from;
  };

  var extRe = /\.[^.\/]+$/;
  var indexRe = /\/index(\.[^\/]+)?$/;
  var addExtensions = function(bundle) {
    if (extRe.test(bundle)) {
      var alias = bundle.replace(extRe, '');
      if (!has.call(aliases, alias) || aliases[alias].replace(extRe, '') === alias + '/index') {
        aliases[alias] = bundle;
      }
    }

    if (indexRe.test(bundle)) {
      var iAlias = bundle.replace(indexRe, '');
      if (!has.call(aliases, iAlias)) {
        aliases[iAlias] = bundle;
      }
    }
  };

  require.register = require.define = function(bundle, fn) {
    if (typeof bundle === 'object') {
      for (var key in bundle) {
        if (has.call(bundle, key)) {
          require.register(key, bundle[key]);
        }
      }
    } else {
      modules[bundle] = fn;
      delete cache[bundle];
      addExtensions(bundle);
    }
  };

  require.list = function() {
    var list = [];
    for (var item in modules) {
      if (has.call(modules, item)) {
        list.push(item);
      }
    }
    return list;
  };

  var hmr = globals._hmr && new globals._hmr(_resolve, require, modules, cache);
  require._cache = cache;
  require.hmr = hmr && hmr.wrap;
  require.brunch = true;
  globals.require = require;
})();

(function() {
var global = window;
var __makeRelativeRequire = function(require, mappings, pref) {
  var none = {};
  var tryReq = function(name, pref) {
    var val;
    try {
      val = require(pref + '/node_modules/' + name);
      return val;
    } catch (e) {
      if (e.toString().indexOf('Cannot find module') === -1) {
        throw e;
      }

      if (pref.indexOf('node_modules') !== -1) {
        var s = pref.split('/');
        var i = s.lastIndexOf('node_modules');
        var newPref = s.slice(0, i).join('/');
        return tryReq(name, newPref);
      }
    }
    return none;
  };
  return function(name) {
    if (name in mappings) name = mappings[name];
    if (!name) return;
    if (name[0] !== '.' && pref) {
      var val = tryReq(name, pref);
      if (val !== none) return val;
    }
    return require(name);
  }
};
require.register("aggregate.js", function(exports, require, module) {
var localStorageMemoize = require("lib/localstorage_memoize");
var geocode = require("lib/geocode");

var cachedGeocode = localStorageMemoize.promise("geocoder", geocode);
var cachedReverseGeocode = localStorageMemoize.promise("reverseGeocoder", geocode.reverse);

if (window.location.href.indexOf("localhost") === -1) {
  cachedGeocode.cacheOnly();
  cachedReverseGeocode.cacheOnly();
}

module.exports = function(rawData) {
  var data = [];

  var slim2Promise = $.getJSON("slim-2.json");

  var allNames = _.keys(rawData);

  return $.when(
    $.getJSON("geocode_cache.json"),
    $.getJSON("reverse_geocode_cache.json")
  )
  .then(function(geocodeCacheData, reverseGeocodeCacheData) {
    cachedGeocode.load(geocodeCacheData[0]);
    cachedReverseGeocode.load(reverseGeocodeCacheData[0]);

    _.forOwn(rawData, function(placesForPerson, name) {
      _.each(_.flatten(placesForPerson), function(placeRaw) {
        data.push({
          name: name,
          placeRaw: placeRaw,
          promise: cachedGeocode(placeRaw)
        });
      });
    });

    return $.when.apply($.when, _.pluck(data, 'promise'));
  })
  .then(function() {
      // Geocode all the places
      var geocodeResults = Array.prototype.slice.apply(arguments);
      _(geocodeResults).each(function(result, index) {
        _.extend(data[index], {
          lat: result.lat,
          lon: result.lon,
          reversePromise: cachedReverseGeocode(result)
        });
      });

      return $.when.apply($.when, _.pluck(data, 'reversePromise'));
    })
    .then(function() {
      // Reverse geocode all the places based on the long/lat we get back from
      // the geocoder.
      var reverseResults = Array.prototype.slice.apply(arguments);

      _.each(reverseResults, function(result, index) {
        _.extend(data[index], {
          country: result.address.country,
          countryCode: result.address.country_code
        });
      });
    })
    .then(function() {
      return slim2Promise;
    })
    .then(function(slim2) {
      // alpha2Toid is a map from ISO-3166 alpha-2 code to ISO-3166 numeric id
      //
      // https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes
      var alpha2ToId = _.reduce(slim2, function(result, d) {
        result[d['alpha-2'].toLowerCase()] = parseInt(d['country-code'], 10);
        return result;
      }, {});

      // Places is a unique list of all places. Each city should appear exactly
      // once in this list.
      var places = _.values(_.reduce(data, function(result, d) {
        // We deduplicate places based on their lat,lon. This allows "Ottawa",
        // "Ottawa, Canada", and "Ottawa, Ontario, Canada", to all end up being
        // part of the same data point.
        var key = d.lat + "," + d.lon;
        var place;
        if (!(place = result[key])) {
          place = result[key] = _.extend({
            count: 0,
            names: [],
            countByName: {}
          }, d);
        }
        place.count++;
        place.names = _.uniq([d.name].concat(place.names));
        if (!place.countByName[d.name]) {
          place.countByName[d.name] = 0;
        }
        place.countByName[d.name]++;
        return result;
      }, {}));

      // List of all places, with each place occuring once per person in the
      // list.
      var placesPerPerson = _.reduce(places, function(result, place) {
        return result.concat(_.map(place.names, function(name, index) {
          return {
            name: name,
            nameIndex: index,
            names: place.names,
            lat: place.lat,
            lon: place.lon,
            countryCode: place.countryCode,
            country: place.country,
            // TODO(jlfwong): Rename count to something more helpful, then just
            // use extend
            count: place.countByName[name],
            totalCount: place.count,
            placeRaw: place.placeRaw
          };
        }));
      }, []);

      // List of all the places a person has been in order
      var placesByPerson = _.groupBy(data, 'name');

      // List of pairs of trips taken from place 1 to place 2
      var pairsByPerson = _.reduce(placesByPerson, function(result, places, name) {
        result[name] = _(places)
          .zip([null].concat(places))
          .filter(function(x) { return x[0] && x[1]; })
          .value();

        return result;
      }, {});

      var countriesById = _.reduce(placesPerPerson, function(result, place) {
        var key = alpha2ToId[place.countryCode];
        var country;
        if (!(country = result[key])) {
          country = result[key] = {
            count: 0,
            name: place.country
          };
        }
        // One point per person per city in the country
        country.count++;
        return result;
      }, {});

      var visitedByAtLeastN = _.map(_.range(1, allNames.length + 1), function(n) {
        var ps = _.filter(places, function(place) {
          return place.names.length >= n;
        });

        var cs = _.unique(_.pluck(ps, 'country'));

        return {
          n: n,
          placeCount: ps.length,
          countryCount: cs.length
        };
      });

      var placesVisitedByAll = _.filter(places, function(place) {
        return place.names.length === allNames.length;
      });

      return {
        visitedByAtLeastN: visitedByAtLeastN,
        placesPerPerson: placesPerPerson,
        pairsByPerson: pairsByPerson,
        countriesById: countriesById
      };
    });
};

module.exports.logCaches = function() {
  console.log({
    'cachedGeocode': cachedGeocode.dump(),
    'cachedReverseGeocode': cachedReverseGeocode.dump()
  });
};

// Invoke in browser with: require("aggregate").saveCaches()
module.exports.saveCaches = function() {
  var saveToFile = require("lib/save_to_file");
  saveToFile(cachedGeocode.dump(), 'geocode_cache.json');
  saveToFile(cachedReverseGeocode.dump(), 'reverse_geocode_cache.json');
};

// Invoke in browser with: require("aggregate").clearCaches()
module.exports.clearCaches = function() {
  cachedGeocode.clear();
  cachedReverseGeocode.clear();
};

});

require.register("data.js", function(exports, require, module) {
var FAMILY_2007 = [
  //Jun 2007
  "Rishikesh, India",
  "Delhi, India",
]

var FAMILY_IMMIGRATION = [
  "Delhi, India",
  "New York, NY",
  "Savannah, GA",
];

var FAMILY_2010 = [
  //Dec 2009
  "Atlanta, GA",
  "Savannah, GA",
  //Apr 2010
  "Washington, DC",
  "Savannah, GA",
  //May
  "Atlanta, GA",
  "Memphis, TN",
  "Atlanta, GA",
  "Savannah, GA",
  //Jul
  "New York, NY",
  "Scranton, PA",
  "Buffalo, NY",
  "Bluefield, WV",
  "Savannah, GA",
  //Dec
  "Orlando, FL",
  "Savannah, GA",
];

var FAMILY_2011 = [
  //Mar
  "Atlanta, GA",
  "Savannah, GA",
  "West Palm Beach, FL",
  "Miami, FL",
  "Savannah, GA",
];

var FAMILY_2011_ = [
  //Jul
  "Atlanta, GA",
  "Sacramento, CA",
  "San Francisco, CA",
  "Sacramento, CA",
  "Atlanta, GA",
  "Savannah, GA",
  //Nov
  "Myrtle Beach, SC",
  "Savannah, GA",
  "Boston, MA",
  "Savannah, GA",
];

var FAMILY_2011_INDIA = [
  //Dec
  "Washington, DC",
  "Paris, France",
  "New Delhi, India",
  "Aurangabad, India",
  "Shirdi, India",
  "Aurangabad, India",
  "New Delhi, India",
  "Jammu, India",
  "New Delhi, India",
  "Paris, France",
  "Washington, DC",
  "Savannah, GA",
];

var FAMILY_2012 = [
  //May
  "Mobile, AL",
  "New Orleans, LA",
  "Mobile, AL",
  "Savannah, GA",
  //Jun 2012
  "St. Augustine, FL",
  "Savannah, GA",
  "Washington, DC",
  "Savannah, GA",
];

var FAMILY_2012M = [
  //Jul
  "Raleigh, NC",
  "Washington, DC",
  "Savannah, GA",
  "Jacksonville, FL",
  "Savannah, GA",
  //Aug
  "Knoxville, KY",
  "Chicago, IL",
  "Knoxville, KY",
  "Savannah, GA",
];

var FAMILY_2012_ = [
  //Nov
  "Washington, DC",
  "San Francisco",
  "Washington, DC",
  "Savannah, GA",
];

var FAMILY_2013_BEE = [
  //Feb 2013
  "Manning, SC",
  "Kingstree, SC",
  "Savannah, GA",
];

var FAMILY_2013 = [
  //May
  "Richmond, VA",
  "New York, NY", //any stops on the way?
  "New Haven, CT",
  "Richmond, VA",
  "Savannah, GA",
];

var FAMILY_2013_ = [
  //Jul
  "Jacksonville, FL",
  "St. Augustine, FL",
  "Savannah, GA",
  //Sep
  "Myrtle Beach, SC",
  "Savannah, GA",
  //Oct
  "Atlanta, GA",
  "Savannah, GA",
  //Nov
  "Richmond, VA",
  "Washington, DC",
  "Baltimore, MD",
  "Richmond, VA",
  "Savannah, GA",
  //Jan 2014
  "Kingstree, SC",
  "Manning, SC",
  "Savannah, GA",
];

var FAMILY_2014 = [
  //Jan
  "Atlanta, GA",
  "Savannah, GA",
  //Feb
  "Atlanta, GA",
  "Savannah, GA",
  //Apr
  "Washington, DC",
  "Savannah, GA",
  "Charlotte, NC",
  "Paris, France",
  "Charlotte, NC",
  "Savannah, GA",
  //May
  "Atlanta, GA",
  "Indianapolis, IN",
  "Knoxville, KY",
  "Savannah, GA",
  "Atlanta, GA",
  "Savannah, GA",
  //Jun
  "Charleston, SC",
  "Savannah, GA",
];

var FAMILY_2014_1 = [
  "Detroit, MI",
  "London, UK",
  "Nottingham, UK",
  "Newark, UK",
  "Nottingham, UK",
  "Derbyshire, UK",
  "Nottingham, UK",
  "London, UK",
  "Detroit, MI",
  "Savannah, GA",
  //Jul
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2014_ = [
  //Oct
  "Miami, FL",
  "Savannah, GA",
  //Nov
  "Tampa, FL",
  "Key West, FL",
  "Savannah, GA",
];

var FAMILY_2015 = [
  //Jan
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2015_ = [
  //Feb
  "Manning, SC",
  "Kingstree, SC",
  "Savannah, GA",
  //Mar
  "Atlanta, GA",
  "Savannah, GA",
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2015__ = [
  //May
  "Hopewell, VA",
  "Philadelphia, PA",
  "Washington, DC",
  "Chantilly, VA",
  "Raleigh, NC",
  "Savannah, GA",
  "Atlanta, GA",
  "Savannah, GA",
  //Jun
  "Atlanta, GA",
  "Paris, France",
  "Brussels, Belgium",
  "Paris, France",
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2016 = [
  //Nov
  "Seattle, WA",
  "Savannah, GA",
  //Jan 2016
  "Augusta, GA",
  "Savannah, GA",
  "Atlanta, GA",
  "Savannah, GA",
  //Feb
  "Manning, SC",
  "Kingstree, SC",
  "Savannah, GA",
  "Atlanta, GA",
  "Savannah, GA",
  //Mar
  "Woodbridge, VA",
  "Boston, MA",
  "Woodbridge, VA",
  "Savannah, GA",
  //Jun
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2016_ = [
  //Jul
  "Raleigh, NC",
];

var FAMILY_2016__ = [
  "Hillsborough, NC",
  "Raleigh, NC",
  "Charlotte, NC",
  "Asheville, NC",
  "Savannah, GA",
  //Aug
  "Atlanta, GA",
  "Savannah, GA",
];

var FAMILY_2016___ = [
  //Sep
  "St. Augustine, FL",
  "Jacksonville, FL",
  "Savannah, GA",
];

var FAMILY_2016____ = [
  //Oct
  "Macon, GA",
  "Atlanta, GA",
  "Savannah, GA",
];

module.exports = {
  "Aryaman": [
    "Delhi, India",
    FAMILY_2007,
    FAMILY_IMMIGRATION,
    FAMILY_2010,
    FAMILY_2011,
    FAMILY_2011_,
    FAMILY_2011_INDIA,
    FAMILY_2012,
    FAMILY_2012M,
    FAMILY_2012_,
    "Atlanta, GA",
    "Athens, GA",
    "Savannah, GA",
    FAMILY_2013_BEE,
    "Charleston, SC",
    "Savannah, GA",
    FAMILY_2013,
    FAMILY_2013_,
    FAMILY_2014,
    FAMILY_2014_1,
    "Atlanta, GA",
    "Baltimore, MD",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2014_,
    FAMILY_2015,
    FAMILY_2015_,
    "Folkston, GA",
    "Savannah, GA",
    FAMILY_2015__,
    FAMILY_2016,
    FAMILY_2016_,
    FAMILY_2016__,
    FAMILY_2016___,
    "Charleston, SC",
    "Savannah, GA",
    FAMILY_2016____,
  ],
  "Amay": [
    "Delhi, India",
    FAMILY_2007,
    FAMILY_IMMIGRATION,
    FAMILY_2010,
    FAMILY_2011,
    FAMILY_2011_,
    FAMILY_2011_INDIA,
    FAMILY_2012,
    FAMILY_2012M,
    FAMILY_2012_,
    "Atlanta, GA",
    "Athens, GA",
    "Savannah, GA",
    FAMILY_2013_BEE,
    "Charleston, SC",
    "Savannah, GA",
    FAMILY_2013,
    FAMILY_2013_,
    FAMILY_2014,
    FAMILY_2014_1,
    FAMILY_2014_,
    FAMILY_2015,
    FAMILY_2015_,
    FAMILY_2015__,
    FAMILY_2016,
    "Greensboro, NC",
    "Raleigh, NC",
    FAMILY_2016_,
    FAMILY_2016__,
    FAMILY_2016___,
    "Charleston, SC",
    "Savannah, GA",
    FAMILY_2016____,
  ],
  "Anshu": [
    "Delhi, India",
    FAMILY_2007,
    "New York, NY",
    "Phoenix, AZ",
    "Grand Canyon National Park, AZ",
    "Phoenix, AZ",
    "San Francisco, CA",
    "Phoenix, AZ",
    "Cincinnati, OH",
    "Lexington, KY",
    "Chicago, IL",
    "Delhi, India",
    "Frankfurt, Germany",
    "Chicago, IL",
    "Savannah, GA",
    "Chicago, IL",
    "Frankfurt, Germany",
    "Delhi, India",
    FAMILY_IMMIGRATION,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2010,
    FAMILY_2011,
    FAMILY_2011_,
    FAMILY_2011_INDIA,
    FAMILY_2012,
    "Brussels, Belgium",
    "Delhi, India",
    "Agra, India",
    "Jaipur, India",
    "Goa, India",
    "Delhi, India",
    "Brussels, Belgium",
    "Savannah, GA",
    FAMILY_2012M,
    "Charlotte, NC", //Dec
    "Richmond, VA",
    "Charlotte, NC",
    "Savannah, GA", //Jan
    "Atlanta, GA",
    "Philadelphia, PA",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2012_,
    "Atlanta, GA",
    "Athens, GA",
    "Savannah, GA",
    FAMILY_2013_BEE,
    "Charleston, SC", //Feb
    "Savannah, GA",
    "St. Paul, MN",
    "Chicago, IL",
    "St. Paul, MN",
    "Savannah, GA",
    "Atlanta, GA",
    "Philadelphia, PA",
    "Atlanta, GA",
    "Savannah, GA",
    "Richmond, VA",
    "Philadelphia, PA",
    "Richmond, VA",
    "Savannah, GA",
    "Dallas, TX",
    "San Francisco, CA",
    "Chico, CA",
    "San Francisco, CA",
    "Dallas, TX",
    "Savannah, GA",
    FAMILY_2013,
    "Charlotte, NC",
    "New York, NY",
    "Charlotte, NC",
    "Savannah, GA",
    FAMILY_2013_,
    "Atlanta, GA",
    "Los Angeles, CA",
    "Sydney, Australia",
    "Brisbane, Australia",
    "Sydney, Australia",
    "Los Angeles, CA",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2014,
    FAMILY_2014_1,
    "Atlanta, GA",
    "Baltimore, MD",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2014_,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2015,
    "San Antonio, TX",
    "Savannah, GA",
    FAMILY_2015_,
    "Atlanta, GA",
    "Chicago, IL",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2015__,
    FAMILY_2016,
    "Greensboro, NC",
    "Raleigh, NC",
    FAMILY_2016_,
    "Atlanta, GA",
    "New Orleans, LA",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2016__,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2016___,
    FAMILY_2016____,
  ],
  "Amit": [
    "Delhi, India",
    FAMILY_2007,
    "Mumbai, India",
    FAMILY_IMMIGRATION,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2010,
    FAMILY_2011,
    "Atlanta, GA",
    "Phoenix, AZ",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2011_,
    "Washington, DC",
    "Dubai, UAE",
    "New Delhi, India",
    "Aurangabad, India",
    "Shirdi, India",
    "Aurangabad, India",
    "New Delhi, India",
    "Jammu, India",
    "New Delhi, India",
    "Dubai, UAE",
    "Washington, DC",
    "Savannah, GA",
    FAMILY_2012,
    FAMILY_2012M,
    FAMILY_2012_,
    "Atlanta, GA",
    "Athens, GA",
    "Savannah, GA",
    FAMILY_2013_BEE,
    "Charleston, SC",
    "Savannah, GA",
    "Atlanta, GA",
    "Philadelphia, PA",
    "Atlanta, GA",
    "Savannah, GA",
    "Richmond, VA",
    "Philadelphia, PA",
    "Richmond, VA",
    "Savannah, GA",
    FAMILY_2013,
    FAMILY_2013_,
    FAMILY_2014,
    "Atlanta, GA",
    "Memphis, TN",
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2014_1,
    "New York, NY",
    "Delhi, India",
    "New York, NY",
    "Savannah, GA",
    FAMILY_2014_,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2015,
    FAMILY_2015_,
    FAMILY_2015__,
    FAMILY_2016,
    "Greensboro, NC",
    "Raleigh, NC",
    FAMILY_2016_,
    FAMILY_2016__,
    "Atlanta, GA",
    "Savannah, GA",
    FAMILY_2016___,
    FAMILY_2016____,
    "Atlanta, GA",
    "Austin, TX",
    "Atlanta, GA"
  ],
};

});

require.register("lib/geocode.js", function(exports, require, module) {
var geocode = module.exports = function (q) {
  return $.ajax("http://nominatim.openstreetmap.org/search/", {
    data: {
      q: q,
      format: "json"
    }
  }).then(function(data) {
    if (!data || !data[0]) {
      throw new Error("Geocoding '" + q + "' failed.");
    }
    return {
      lat: parseFloat(data[0].lat, 10),
      lon: parseFloat(data[0].lon, 10)
    };
  });
};

geocode.reverse = function(args) {
  return $.ajax("http://nominatim.openstreetmap.org/reverse", {
    data: {
      lat: args.lat,
      lon: args.lon,
      zoom: 8,
      format: "json",
      addressdetails: 1
    }
  }).then(function(data) {
    if (!data) {
      throw new Error("Reverse Geocoding '" + args + "' failed.");
    }
    return {
      display_name: data.display_name,
      address: data.address
    };
  });
};

});

require.register("lib/localstorage_memoize.js", function(exports, require, module) {
var localStorageMemoize = function(cacheKeyPrefix, fn) {
  var localStorageKey = "lsMemoV1_" + cacheKeyPrefix;
  var cache;

  if (!(cache = JSON.parse(localStorage.getItem(localStorageKey)))) {
    cache = {};
  }

  var memoed = function() {
    var args = Array.prototype.slice.apply(arguments);
    var argKey = JSON.stringify(args);
    if (!(cache[argKey])) {
      cache[argKey] = fn.apply(this, args);
      localStorage.setItem(localStorageKey, JSON.stringify(cache));
    }
    return cache[argKey];
  };

  memoed.clear = function() {
    cache = {};
    localStorage.setItem(localStorageKey, JSON.stringify(cache));
  };

  return memoed;
};

// TODO(jlfwong): Generalize for any number of resolve args?
localStorageMemoize.promise = function(cacheKeyPrefix, fn) {
  var localStorageKey = "pMemoV1_" + cacheKeyPrefix;
  var cache;
  var cacheOnly = false;

  if (!(cache = JSON.parse(localStorage.getItem(localStorageKey)))) {
    cache = {};
  }

  var memoed = function() {
    var args = Array.prototype.slice.apply(arguments);
    var argKey = JSON.stringify(args);
    var deferred = $.Deferred();
    var cachedVal = cache[argKey];
    if (cachedVal) {
      deferred.resolveWith(null, cachedVal);
    } else {
      if (cacheOnly) {
        throw new Error(
            "Cache only mode enabled. Cache miss on '" + argKey + "'.");
      }
      fn.apply(this, args).then(function() {
        var args = Array.prototype.slice.apply(arguments);
        cache[argKey] = args;
        memoed.save();
        deferred.resolveWith(null, args);
      });
    }
    return deferred.promise();
  };

  memoed.save = function() {
    localStorage.setItem(localStorageKey, JSON.stringify(cache));
  };

  memoed.clear = function() {
    cache = {};
    memoed.save();
  };

  memoed.dump = function() {
    return cache;
  };

  memoed.load = function(savedCache) {
    _.extend(cache, savedCache);
    memoed.save();
  };

  memoed.cacheOnly = function() {
    cacheOnly = true;
    return memoed;
  };

  return memoed;
};

module.exports = localStorageMemoize;

});

require.register("lib/save_to_file.js", function(exports, require, module) {
// Based on
// https://raw.github.com/bgrins/devtools-snippets/master/snippets/console-save/console-save.js
var saveToFile = function(data, filename) {
  if (!data) {
    console.error('Console.save: No data');
    return;
  }

  if (!filename) {
    filename = 'console.json';
  }

  if (typeof data === "object") {
    data = JSON.stringify(data, undefined, 4);
  }

  var blob = new Blob([data], {type: 'text/json'}),
      e    = document.createEvent('MouseEvents'),
      a    = document.createElement('a');

  a.download = filename;
  a.href = window.URL.createObjectURL(blob);
  a.dataset.downloadurl =  ['text/json', a.download, a.href].join(':');
  e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
  a.dispatchEvent(e);
};

module.exports = saveToFile;

});

require.register("lib/unique_counter.js", function(exports, require, module) {
module.exports = function() {
  var cache = {};
  var counter = 0;
  return function(val) {
    if (!cache.hasOwnProperty(val)) {
      cache[val] = counter++;
    }
    return cache[val];
  };
};

});

require.register("main.js", function(exports, require, module) {
var data = require("data");
var aggregate = require("aggregate");
var render = require("render");
var projections = require("projections");

var makeMap = function(container, projection, processed, world) {
  var svg = d3.select(container)
    .append("svg")
    .attr("width", projection.width)
    .attr("height", projection.height);

  render({
    svg: svg,
    projection: projection,
    world: world,
    processed: processed,
    width: projection.width,
    height: projection.height
  });

  return svg;
};

module.exports = function() {
  $(function() {
    var width = $(window).width() * 0.9;

    var world50mPromise = $.getJSON("world-50m.json").then(_.identity);

    $.when(aggregate(data), world50mPromise).then(function(processed, world) {
      render.makeToggles(_.keys(data));
      render.makeBars(processed.visitedByAtLeastN);

      d3.select(".outer-container")
        .append("div")
        .attr("class", "container")
        .style("width", width + "px");

      d3.select(".container").append("h2").text("North America");
      makeMap(".container", projections.northAmerica(width), processed, world);
      d3.select(".container").append("h2").text("East Coast");
      makeMap(".container", projections.eastCoast(width), processed, world);
      d3.select(".container").append("h2").text("India");
      makeMap(".container", projections.india(width), processed, world);
      d3.select(".container").append("h2").text("Europe");
      makeMap(".container", projections.europe(width), processed, world);
      d3.select(".container").append("h2").text("World");
      makeMap(".container", projections.world(width), processed, world);
    });
  });
};

});

require.register("projections.js", function(exports, require, module) {
var getBounds = function(projection, lonLatBounds) {
  var box = [
    projection(lonLatBounds[0]),
    projection(lonLatBounds[1])
  ];

  return {
    box: box,
    width: box[1][0] - box[0][0],
    height: box[1][1] - box[0][1]
  };
};

var mercatorProj = function(width, lonLatBounds) {
  var projection = d3.geo.mercator()
      .translate([0, 0])
      .precision(0.1);

  var bounds;
  bounds = getBounds(projection, lonLatBounds);

  var height = width * (bounds.height / bounds.width);
  projection.scale(projection.scale() * (height / bounds.height));

  bounds = getBounds(projection, lonLatBounds);

  projection
    .translate([-bounds.box[0][0], -bounds.box[0][1]])
    .clipExtent([[0, 0], [width, height]]);

  projection.width = width;
  projection.height = height;

  return projection;
};

exports.world = function(width) {
  return mercatorProj(width, [
    [-180, 83],
    [180, -65]
  ]).rotate([-10, 0, 0]);
};

exports.northAmerica = function(width) {
  return mercatorProj(width, [
    [-130, 55],
    [-50, 20]
  ]);
};

exports.eastCoast = function(width) {
  return mercatorProj(width, [
    [-100, 45],
    [-70, 23]
  ]);
}

exports.europe = function(width) {
  return mercatorProj(width, [
    [-30, 61],
    [35, 34]
  ]);
};

exports.india = function(width) {
  return mercatorProj(width, [
    [65, 40],
    [100, 5]
  ]);
};

});

require.register("render.js", function(exports, require, module) {
var uniqueCounter = require("lib/unique_counter");

var colors = d3.scale.category10();
var nameCounter = uniqueCounter();

var nameColor = function(name) {
  return colors(nameCounter(name));
};

module.exports = function(opts) {
  var svg = opts.svg;
  var projection = opts.projection;
  var world = opts.world;
  var processed = opts.processed;
  var width = opts.width;
  var height = opts.height;

  var path = d3.geo.path()
      .projection(projection);

  var arc = d3.svg.arc().innerRadius(0);

  var tooltip = d3.select("body")
    .append("div")
    .attr('class', 'tooltip')
    .style({
      "position": "absolute",
      "z-index": "10",
      "background": "rgba(20, 20, 20, 0.5)",
      "color": "rgba(150, 150, 150, 0.5)",
      "border-radius": "5px",
      "padding": "2px",
      "display": "none"
    });

  svg.selectAll(".country")
    .data(topojson.feature(world, world.objects.countries).features)
    .enter()
    .insert("path")
    .attr({
      "class": "country",
      "fill": function(d) {
        var country = processed.countriesById[d.id];
        var count = 0;
        var visited = false;
        if (country) {
          visited = true;
          count = country.count;
        }
        var grey = 10 + 5 * visited + 2 * Math.pow(count, 1.0/2.5);
        return d3.rgb(grey, grey, grey);
      },
      "d": path
    });

  svg.insert("path")
    .datum(topojson.mesh(world, world.objects.countries, function(a, b) {
      return a !== b;
    }))
    .attr("class", "boundary")
    .attr("d", path);

  var placesPerPerson = _(processed.placesPerPerson)
    .sortBy("lon")
    .sortBy("totalCount")
    .filter(function(d) {
      var proj = projection([d.lon, d.lat]);
      return (proj && !(
        proj[0] < 0 || proj[0] >= width ||
        proj[1] < 0 || proj[1] >= height));
    })
    .value();

  // scale factor
  var sf = Math.pow((projection.scale() / 205) * (projection.width / 1400), 1/3);

  var totalAnimTime = 5000;

  var filteredPairsByPerson = {};
  _.forOwn(processed.pairsByPerson, function(pairs, name) {
    filteredPairsByPerson[name] = _.filter(pairs, function(pair) {
      var c1 = projection([pair[0].lon, pair[0].lat]);
      var c2 = projection([pair[1].lon, pair[1].lat]);

      if (!c1 || !c2) return false;

      return !((c1[0] < 0 || c1[0] > projection.width ||
                c1[1] < 0 || c1[1] > projection.height) ||
                (c2[0] < 0 || c2[0] > projection.width ||
                c2[1] < 0 || c2[1] > projection.height));
      });
  });

  var nDots = placesPerPerson.length;
  var nPaths = _.flatten(_.values(filteredPairsByPerson)).length;

  var totalAnimLength = 10000;
  var dotDuration = 500;
  var dotDelay = (totalAnimLength / 2 - dotDuration) / nDots;
  var pathStart = totalAnimLength / 2;
  var pathDelay = (totalAnimLength / 2) / (nPaths + 1);

  var pairsBefore = 0;
  _.forOwn(filteredPairsByPerson, function(filteredPairs, name) {
    svg.selectAll(".travelpath." + name)
      .data(filteredPairs)
      .enter()
      .append("path")
      .attr("class", "travelpath " + name)
      .attr("stroke-width", (1 * sf) + 'px')
      .attr("stroke-opacity", 0)
      .attr("stroke", nameColor(name))
      .attr("fill-opacity", 0)
      .attr("d", "M0,0");

    $(svg.node()).waypoint(_.once(function() {
      svg.selectAll(".travelpath." + name)
        .data(filteredPairs)
        .transition()
        .duration(pathDelay)
        .delay(function(d, i) { return pathStart + (pairsBefore + i) * pathDelay; })
        .attr("stroke-opacity", 0.25)
        .attrTween("d", function(pair) {
          var c1 = projection([pair[0].lon, pair[0].lat]);
          var c2 = projection([pair[1].lon, pair[1].lat]);

          // TODO(jlfwong): Increase jitter for shorter distances
          var radius = (width / 2) * (1 + 0.2 * Math.random());

          var dst = d3.interpolate(c1, c2);
          var rad = d3.interpolate(radius * radius, radius);

          return function(t) {
            var c2 = dst(t);
            var r = rad(t);
            return (
              "M" + c1[0] + "," + c1[1] +
              " A" + r + "," + r +
              " 0 0,0 " + c2[0] + "," + c2[1]
            );
          };
        });

      pairsBefore += filteredPairs.length;
    }), {offset: '50%'});
  });

  svg.selectAll(".place")
    .data(placesPerPerson)
    .enter()
    .append("path")
    .attr("class", function(d) {
      return "place " + d.name;
    })
    .attr({
      "fill": function(d) {
        return nameColor(d.name);
      },
      "fill-opacity": 0,
      "transform": function(d) {
        var proj = projection([d.lon, d.lat]);
        return "translate(" + proj[0] + "," + proj[1] + ")";
      },
      "d": function(d) {
        var sliceAngle = 2 * Math.PI / d.names.length;
        return arc({
          outerRadius: sf * (1 + 2 * Math.log(1 + d.totalCount)),
          startAngle: d.nameIndex * sliceAngle,
          endAngle: (d.nameIndex + 1) * sliceAngle
        });
      }
    })
    .on("mouseover", function(d) {
      tooltip.text(d.placeRaw + " (" + d.names.join(", ") + ")");
      tooltip.style("display", "block");
    })
    .on("mousemove", function() {
      tooltip.style({
        "top":  (event.pageY - 10) + "px",
        "left": (event.pageX + 10) + "px"
      });
    })
    .on("mouseout", function() {
      tooltip.style("display", "none");
    });

  $(svg.node()).waypoint(_.once(function() {
    svg.selectAll(".place")
      .data(placesPerPerson)
      .transition()
      .ease("bounce")
      .duration(dotDuration)
      .delay(function(d, i) { return i * dotDelay; })
      .attr("fill-opacity", 0.75);
  }), {offset: '50%'});
};

module.exports.makeBars = function(visitedByAtLeastN) {
  var table = d3.select(".stats")
    .append("table")
    .attr("class", "bars");

  var headerTr = table.append("thead").append("tr");

  headerTr.append("th").text("# places").attr("class", "places");
  headerTr.append("th").text("visited by...").attr("class", "visited-by");
  headerTr.append("th").text("# countries").attr("class", "countries");

  var placeCountScale = d3.scale.linear()
    .domain([0, _.max(_.pluck(visitedByAtLeastN, 'placeCount'))])
    .range([0, 100]);

  var countryCountScale = d3.scale.linear()
    .domain([0, _.max(_.pluck(visitedByAtLeastN, 'countryCount'))])
    .range([0, 100]);

  var trs = table.selectAll(".bars tr.data-row")
    .data(visitedByAtLeastN)
    .enter()
    .append("tr")
    .attr("class", "data-row");

  trs
    .append("td")
    .attr("class", "places")
    .append("div")
    .style("width", "10%")
    .append("span")
    .text(function(d) { return d.placeCount; });

  trs
    .append("td")
    .attr("class", "visited-by")
    .html(function(d) {
      return (
        ((d.n == visitedByAtLeastN.length) ? "" : "&ge; ") +
        d.n +
        " Arora" +
        ((d.n == 1) ? "" : "s")
      );
    });

  trs
    .append("td")
    .attr("class", "countries")
    .append("span")
    .append("div")
    .style("width", "10%")
    .append("span")
    .text(function(d) { return d.countryCount; });

  // TODO(jlfwong): Figure out why the bars start at 50% width instead of 0...

  _.defer(function() { _.delay(function() {
    table.selectAll(".data-row .places div")
      .data(visitedByAtLeastN)
      .transition()
      .duration(1000)
      .ease("bounce")
      .delay(function(d, i) { return i * 100; })
      .style("width", function(d) { return placeCountScale(d.placeCount) + '%'; });

    table.selectAll(".data-row .countries div")
      .data(visitedByAtLeastN)
      .transition()
      .duration(1000)
      .ease("bounce")
      .delay(function(d, i) { return i * 100; })
      .style("width", function(d) { return countryCountScale(d.countryCount) + '%'; });
  }, 100); });
};

module.exports.makeToggles = function(names) {
  var enabled = _.reduce(names, function(result, val) {
    result[val] = true;
    return result;
  }, {});

  var update = function() {
    _.each(names, function(name) {
      var show = enabled[name];
      d3.selectAll('.' + name).style('display', show ? 'inline' : 'none');
      d3.select('.label-' + name).style('color', show ? nameColor(name) : '#444');
    });
  };

  var toggles = d3.select(".outer-container")
    .append("div")
    .attr("class", "toggles");

  var lis = toggles
    .append("ul")
    .selectAll("li")
    .data(names)
    .enter()
    .append("li");

  lis
    .append("a")
    .attr("href", "#")
    .text('toggle')
    .on('click', function(name) {
      enabled[name] = !enabled[name];
      update();
      event.preventDefault();
    });

  lis
    .append("a")
    .attr("href", "#")
    .text('only')
    .on('click', function(name) {
      _.each(names, function(name) { enabled[name] = false; });
      enabled[name] = true;
      update();
      event.preventDefault();
    });

  lis
    .append("span")
    .attr("href", "#")
    .attr("class", function(name) {
      return "label-" + name;
    })
    .style({
      "color": nameColor,
      "text-decoration": "none"
    })
    .text(_.identity);

  toggles.append("a")
    .attr("href", "#")
    .text("show all")
    .on('click', function() {
      _.each(names, function(name) { enabled[name] = true; });
      update();
      event.preventDefault();
    });

  $(toggles.node()).waypoint("sticky");
};

});

require.register("___globals___", function(exports, require, module) {
  
});})();require('___globals___');


//# sourceMappingURL=app.js.map