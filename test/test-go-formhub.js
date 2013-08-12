var fs = require("fs");
var assert = require("assert");
var vumigo = require("vumigo_v01");
// CHANGE THIS to your-app-name
var app = require("../lib/go-formhub");

// This just checks that you hooked you InteractionMachine
// up to the api correctly and called im.attach();
describe("test_api", function () {
  it("should exist", function () {
    assert.ok(app.api);
  });
  it("should have an on_inbound_message method", function () {
    assert.ok(app.api.on_inbound_message);
  });
  it("should have an on_inbound_event method", function () {
    assert.ok(app.api.on_inbound_event);
  });
});

describe('FormHub', function () {

  var tester;
  var fixtures = [
    'test/fixtures/good-eats-formhub.json',
    'test/fixtures/good-eats-formhub-submission.json',
    'test/fixtures/geolocation.json'
  ];

  var mocked_get_date = function () {
    return new Date(2013, 7, 11, 8, 0, 0);
  };

  beforeEach(function () {
    tester = new vumigo.test_utils.ImTester(app.api, {
      custom_setup: function (api) {
        api.config_store.config = JSON.stringify({
          formhub: {
            url: 'https://formhub.org/mberg/forms/good_eats/form.json'
          }
        });
        fixtures.forEach(function (f) {
          api.load_http_fixture(f);
        });

        // mock methods for testing
        var state_creator = tester.api.im.state_creator;
        state_creator.get_date = mocked_get_date;
      },
      async: true
    });
  });

  it('should retrieve the JSON fixture and generate the states', function (done) {
    var p = tester.check_state({
      user: null,
      content: null,
      next_state: '__initial_state__',
      response: '^Welcome to FormHub! You are about to enter data for good_eats.[^]' +
                '1. Continue$'
    }).then(done, done);
  });

  it('should continue to the first question when starting from the opening menu', function(done) {
    var p = tester.check_state({
      user: {
        current_state: '__initial_state__'
      },
      content: '1',
      next_state: 'submit_data',
      response: '^The date for today will be captured as (.+)\.[^]' +
                '1. Continue$'
    }).then(done, done);
  });

  it('should handle `today` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'submit_data',
      },
      content: '1',
      next_state: 'food_type',
      response: '^Type of Eat[^]' +
                '1. Morning Food'
    }).then(function() {
      var im = app.api.im;
      assert.equal(
        im.get_user_answer('submit_data'),
        mocked_get_date().toISOString());
    }).then(done, done);
  });

  it('should handle `select one` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'food_type'
      },
      content: '1',
      next_state: 'description',
      response: 'Description'
    }).then(done, done);
  });

  it('should handle `text` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'description'
      },
      content: 'foo',
      next_state: 'amount',
      response: '^Amount \\(In local currency\\)$'
    }).then(done, done);
  });

  it('should handle valid input for `decimal` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'amount'
      },
      content: '1.2',
      next_state: 'rating',
      response: '^Rating[^]' +
                '1. Epic Eat[^]' +
                '2. Delectible[^]' +
                '3. Nothing Special[^]' +
                '4. What was I thinking$'
    }).then(done, done);
  });

  it('should retry invalid input for `decimal` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'amount'
      },
      content: 'foo',
      next_state: 'amount',
      response: '^Please provide a decimal value for: Amount$'
    }).then(done, done);
  });

  it('should gracefully degrade the `photo` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'risk_factor'
      },
      content: '1',
      next_state: 'food_photo',
      response: '^FormHub wants a photo but this is not supported over USSD.[^]' +
                '1. Continue$'
    }).then(done, done);
  });

  it('should handle the `geopoint` type by using Google Maps', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'location_photo'
      },
      content: '1',
      next_state: 'gps',
      response: '^Location \\(So you can find it again\\)$'
    }).then(done, done);
  });

  it('should come back with a list of matches', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'gps'
      },
      content: '1600 Amphitheatre Parkway',
      next_state: 'matches_for_gps',
      response: '^Please select a match[^]' +
                '1. 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA[^]' +
                '2. None of the above$'
    }).then(done, done);
  });

  it('should gracefully degrate the `imei` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'matches_for_gps',
        answers: {
          'gps': '1600 Amphitheatre Parkway'
        }
      },
      content: '1',
      next_state: 'imei',
      response: '^FormHub wants to capture the IMEI but this is not supported over USSD.[^]' +
                '1. Submit MSISDN instead[^]' +
                '2. Leave blank$'
    }).then(done, done);
  });

  it('should capture the user\'s MSISDN if asked to do so', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'imei',
      },
      content: '1',
      next_state: 'submit_date',
      response: '^The date for today will be captured as'
    }).then(function() {
      var im = app.api.im;
      assert.equal(im.get_user_answer('imei'), '1234567');
    }).then(done, done);
  });

  it('should not capture the user\'s MSISDN if asked not to do so', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'imei',
      },
      content: '2',
      next_state: 'submit_date',
      response: '^The date for today will be captured as'
    }).then(function() {
      var im = app.api.im;
      assert.equal(im.get_user_answer('imei'), null);
    }).then(done, done);
  });

  it('should go to the end state when done', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'submit_date',
      },
      content: '1',
      next_state: '__end_state__',
      response: 'The data has been submitted succesfully',
      continue_session: false
    }).then(done, done);
  });

});