var vumigo = require("vumigo_v01");
var jed = require("jed");

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
       self._formhub_id_string + '.'),
      [
        new Choice('1', 'Continue')
      ])
  });

  self.build_formhub_states = function (response) {
    var form = JSON.parse(response.body);
    var children = form.children;
    im.log('Building ' + children.length + ' states for '
        + form.id_string);
    children.forEach(function (child, index) {
      // hand over the child to the builder for this child-type.
      if (index == 0) {
        self._formhub_first_state = child.name;
        self._formhub_id_string = form.id_string;
      }
      var current_state = child.name;
      if(!self.state_exists(current_state)) {
        var next_state = (index + 1 == children.length ?
                          '__end_state__' : children[index + 1].name);
        var builder_name = self.child_map[child.type];
        var builder = self[builder_name];
        builder(index, current_state, next_state, child);
      }
    });
  };

  self.get_date = function () {
    return new Date();
  }

  self.add_state(new EndState(
    '__end_state__',
    'The data has been submitted succesfully',
    '__initial_state__'));

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
    self.add_state(new ChoiceState(
      current_state,
      next_state,
      'FormHub wants a GeoIP but this is not supported over USSD.',
      [
        new Choice('1', 'Continue')
      ]
      ));
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
    return p;
  }
}

// launch app
var states = new GoFormHub();
var im = new InteractionMachine(api, states);
im.attach();
