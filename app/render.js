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
