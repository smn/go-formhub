var vumigo = require("vumigo_v01");
var jed = require("jed");
var libxml = require('libxmljs');

if (typeof api === "undefined") {
  // testing hook (supplies api when it is not passed in by the real sandbox)
  var api = this.api = new vumigo.dummy_api.DummyApi();
}

var Promise = vumigo.promise.Promise;
var success = vumigo.promise.success;
var Choice = vumigo.states.Choice;
var ChoiceState = vumigo.states.ChoiceState;
var PaginatedChoiceState = vumigo.states.PaginatedChoiceState;
var FreeText = vumigo.states.FreeText;
var EndState = vumigo.states.EndState;
var BookletState = vumigo.states.BookletState;
var InteractionMachine = vumigo.state_machine.InteractionMachine;
var StateCreator = vumigo.state_machine.StateCreator;

function GoFormHub() {
  var self = this;

  // The first state to enter
  StateCreator.call(self, '__initial_state__');

  // the HTTP headers for FormHub
  self.headers = {
    'content-type': 'application/json'
  };

  // map FormHub's types to internal state classes.
  self.child_map = {
    'today': 'build_today',
    'select one': 'build_select_one',
    'text': 'build_text',
    'decimal': 'build_decimal',
    'photo': 'build_photo',
    'geopoint': 'build_geopoint',
    'imei': 'build_imei'
  };

  self.add_creator('__initial_state__', function(state_name, im) {
    return new ChoiceState(
      state_name,
      self._formhub_first_state,
      ('Welcome to FormHub! You are about to enter data for ' +
       self._formhub_title + '.'),
      [
        new Choice('1', 'Continue')
      ])
  });

  self.build_formhub_states = function (response) {
    var form = JSON.parse(response.body);
    var children = form.children;
    im.log('Building ' + children.length + ' states for '
        + form.title);
    return children.map(function (child, index) {
      // hand over the child to the builder for this child-type.
      if (index == 0) {
        self._formhub_first_state = child.name;
        self._formhub_title = form.title;
      }
      var current_state = child.name;
      if(!self.state_exists(current_state)) {
        var next_state = (index + 1 == children.length ?
                          '__end_state__' : children[index + 1].name);
        var builder_name = self.child_map[child.type];
        var builder = self[builder_name];
        builder(index, current_state, next_state, child);
      }
      return current_state;
    });
  };

  self.store_state_names = function (state_names) {
    self._formhub_state_names = state_names;
  };

  self.get_date = function () {
    return new Date();
  };

  self.url_encode = function(params) {
      var items = [];
      for (var key in params) {
          items[items.length] = (encodeURIComponent(key) + '=' +
                                 encodeURIComponent(params[key]));
      }
      return items.join('&');
  };

  self.geolocate_get = function(address) {
    var url = "http://maps.googleapis.com/maps/api/geocode/json";
    url = url + '?' + self.url_encode({
        'address': address,
        'sensor': 'false'
    });

    var p = im.api_request('http.get', {
      url: url,
    });
    p.add_callback(function(response) {
      return JSON.parse(response.body);
    });
    return p;
  };

  self.find_addresses = function(address) {
      var addresses = self.geolocate_get(address);
      addresses.add_callback(function(json) {
          return json.results.map(function(result) {
              var location = result.geometry.location;
              return {
                  id: location.lat + ' ' + location.lng,
                  text: result.formatted_address
              };
          });
      });
      return addresses;
  };

  self.generate_formhub_submission = function() {
    var doc = new libxml.Document();
    var root = doc.node(self._formhub_title);
    root.attr({id: self._formhub_title})
    self._formhub_state_names.forEach(function(state_name) {
      root.node(state_name, im.get_user_answer(state_name));
    });
    return doc.toString();
  }

  self.add_state(new EndState(
    '__end_state__',
    'The data has been submitted succesfully',
    '__initial_state__',
    {
      on_enter: function() {
        console.log(self.generate_formhub_submission());
        im.log('Data should be posted to FormHub here.');
      }
    }));

  self.state_exists = function(state_name) {
    return self.state_creators.hasOwnProperty(state_name);
  }

  self.build_today = function (index, current_state, next_state, child) {
    self.add_state(new ChoiceState(
      current_state,
      next_state,
      'The date for today will be captured as ' + self.get_date().toISOString() + '.',
      [
        new Choice('1', 'Continue')
      ]
      ))
  };

  self.build_select_one = function (index, current_state, next_state, child) {
    self.add_state(new PaginatedChoiceState(
      current_state,
      next_state,
      child.label,
      child.children.map(function(option) {
        return new Choice(option.name, option.label);
      }),
      null,  // error
      null,  // handler
      {}));  // page-opts
  };

  self.build_text = function (index, current_state, next_state, child) {
    self.add_state(new FreeText(
      current_state,
      next_state,
      child.label));
  };

  self.build_decimal = function (index, current_state, next_state, child) {
    self.add_state(new FreeText(
      current_state,
      next_state,
      child.hint ? child.label + ' (' + child.hint + ')' : child.label,
      function(content) {
        // check that the value provided is actually decimal-ish.
        return !Number.isNaN(parseFloat(content));
      },
      'Please provide a decimal value for: ' + child.label));
  };

  self.build_photo = function (index, current_state, next_state, child) {
    self.add_state(new ChoiceState(
      current_state,
      next_state,
      'FormHub wants a photo but this is not supported over USSD.',
      [
        new Choice('1', 'Continue')
      ]
      ));
  };

  self.build_geopoint = function (index, current_state, next_state, child) {

    // state for capturing address
    self.add_state(new FreeText(
      current_state,
      'matches_for_' + current_state,
      child.label + ' (' + child.hint + ')'
    ));

    // state for selecting geolocated matches
    self.add_creator('matches_for_' + current_state, function(state_name, im) {
      var given_location = im.get_user_answer(current_state);
      var p = self.find_addresses(given_location);
      p.add_callback(function(matches) {

        var choices = matches.map(function(m) {
          return new Choice(m.id, m.text);
        });
        choices.push(new Choice('try-again', 'None of the above'));

        return new ChoiceState(
          state_name,
          function(choice) {
            if(choice.value == 'try-again') {
              return current_state;
            } else {
              return next_state;
            }
          },
          'Please select a match',
          choices
        )
      });
      return p;
    });
  };

  self.build_imei = function (index, current_state, next_state, child) {
    self.add_state(new ChoiceState(
      current_state,
      next_state,
      'FormHub wants to capture the IMEI but this is not supported over USSD.',
      [
        new Choice('msisdn', 'Submit MSISDN instead'),
        new Choice('blank', 'Leave blank')
      ]
      ));
  };

  self.on_config_read = function (event) {
    var p = im.api_request('http.get', {
      url: im.config.formhub.url,
      headers: self.headers
    });
    p.add_callback(self.build_formhub_states);
    p.add_callback(self.store_state_names);
    return p;
  }
}

// launch app
var states = new GoFormHub();
var im = new InteractionMachine(api, states);
im.attach();
