var assert = require('assert');
var devices = require("../lib/devices.js")

const mockDoorSensor = {
  "ch": 1,
  "vd": ["Back Door"],
  "ser": 193001,
  "cc": true,
  "cb": true,
  "ea": true,
  "ec": 1251,
  "eqt": 1,
  "set": 1,
  "ser32": 16970217,
  "pnlctx": {"ts": "2018-06-16T05:03:49.230000"},
  "er": 1,
  "lb": false,
  "icz": false,
  "ln": 2,
  "tr": false,
  "ts": "2018-06-16T05:03:49.230000",
  "plctx": {"ts": "2018-06-16T05:03:49.230000"},
  "from_sync": 1,
  "re": true,
  "zid": 3,
  "sup": false,
  "panid": 13,
  "ta": false,
  "suv": true,
  "dd": false,
  "b": 0,
  "ccz": false,
  "n": "Back Door",
  "s": false,
  "t": "wireless_sensor",
  "v": true,
  "_id": 28
}

const mockWindowSensor = {
  "ch": 1,
  "vd": [
    "Basement",
    "Shop",
    "Window"
  ],
  "ser": 192977,
  "cc": true,
  "cb": true,
  "ea": true,
  "ec": 1251,
  "eqt": 1,
  "set": 3,
  "ser32": 16970193,
  "pnlctx": {"ts": "2018-06-10T03:04:46.059000"},
  "er": 1,
  "lb": false,
  "icz": false,
  "ln": 2,
  "tr": false,
  "ts": "2018-06-10T03:04:46.059000",
  "plctx": {"ts": "2018-06-10T03:04:46.059000"},
  "from_sync": 1,
  "re": true,
  "zid": 17,
  "sup": false,
  "panid": 13,
  "ta": false,
  "suv": true,
  "dd": false,
  "b": 0,
  "ccz": true,
  "n": "Basement Shop Window",
  "s": false,
  "t": "wireless_sensor",
  "v": true,
  "_id": 42
}

describe('DeviceSet', function() {
  describe('#constructor', function() {
    it('populates the devices with the given delegators', function() {
      var deviceSet = new devices.DeviceSet({}, [mockWindowSensor, mockDoorSensor])
      assert.equal(2, deviceSet.devices.length)
      assert.equal("DoorWindowSensor", deviceSet.devices[0].getType())
      assert.equal("DoorWindowSensor", deviceSet.devices[1].getType())
    });
  });
});
