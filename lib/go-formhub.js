var vumigo = require("vumigo_v01");
var jed = require("jed");
var libxml = require('libxmljs');

if (typeof api === "undefined") {
  // testing hook (supplies api when it is not passed in by the real sandbox)
  var api = this.api = new vumigo.dummy_api.DummyApi();
}

var Promise = vumigo.promise.Promise;
var success = vumigo.promise.success;
var Stae = vumigo.states.State;
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
    self._formhub_state_names = children.map(function (child, index) {
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
      root.node(state_name, self.get_answer(state_name));
    });
    return doc.toString(false);
  };

  self.get_answer = function(state_name) {
    // NOTE:  This is a hack for the geopoint state. Currently the Geopoint
    //        state consists of two separate states, the first one stores the
    //        string of the provided location, the second one has the lat, lot
    //        coordinates we get back from Google. That's the stuff we're
    //        submitting back to FormHub. The hack here is to provide that
    //        value if it exists over the value of the given state name.
    return (im.get_user_answer('matches_for_' + state_name) ||
            im.get_user_answer(state_name));
  };

  self.generate_formhub_submission_url = function() {
    return im.config.formhub.url.replace('.json', '.xml');
  };

  self.add_creator('__end_state__', function(state_name, im) {
    var p = im.api_request('http.post', {
      url: self.generate_formhub_submission_url(),
      data: self.generate_formhub_submission(),
      headers: {
        'Content-Type': ['application/xml']
      }
    });
    p.add_callback(function(response) {
      var lp = im.log(response);
      lp.add_callback(function() {
        return im.log(self.generate_formhub_submission_url());
      });
      lp.add_callback(function() {
        return response;
      });
      return lp;
    });
    p.add_callback(function(response) {
      if(response.code >= 200 && response.code < 300) {
        var response_string = 'The data has been submitted succesfully';
      } else {
        var response_string = 'Something went wrong submitting the data.' +
                              'Please try again.';
      }
      return new EndState(
          state_name,
          response_string,
          '__initial_state__');
    });
    return p;
  });

  self.state_exists = function(state_name) {
    return self.state_creators.hasOwnProperty(state_name);
  }

  self.build_today = function (index, current_state, next_state, child) {
    var date = self.get_date().toISOString();
    self.add_state(new ChoiceState(
      current_state,
      next_state,
      'The date for today will be captured as ' + date + '.',
      [
        new Choice(date, 'Continue')
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
        choices.push(new Choice(null, 'None of the above'));

        return new ChoiceState(
          state_name,
          function(choice) {
            if(choice.value) {
              return next_state;
            } else {
              return current_state;
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
    self.add_creator(current_state, function(state_name, im) {
      return new ChoiceState(
        current_state,
        next_state,
        'FormHub wants to capture the IMEI but this is not supported over USSD.',
        [
          new Choice(im.user_addr, 'Submit MSISDN instead'),
          new Choice(null, 'Leave blank')
        ])
    });
  };

  self.on_config_read = function (event) {
    var p = im.api_request('http.get', {
      url: im.config.formhub.url,
      headers: self.headers
    });
    p.add_callback(self.build_formhub_states);
    return p;
  }
}

// launch app
var states = new GoFormHub();
var im = new InteractionMachine(api, states);
im.attach();
