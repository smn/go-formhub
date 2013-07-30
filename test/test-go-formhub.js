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
    'test/fixtures/good-eats-formhub.json'
  ];

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

  it('should gracefully degrate the `geopoint` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'location_photo'
      },
      content: '1',
      next_state: 'gps',
      response: '^FormHub wants a GeoIP but this is not supported over USSD.[^]' +
                '1. Continue$'
    }).then(done, done);
  });

  it('should gracefully degrate the `imei` type', function(done) {
    var p = tester.check_state({
      user: {
        current_state: 'gps'
      },
      content: '1',
      next_state: 'imei',
      response: '^FormHub wants to capture the IMEI but this is not supported over USSD.[^]' +
                '1. Continue$'
    }).then(done, done);
  });

});