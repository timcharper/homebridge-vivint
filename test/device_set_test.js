const assert = require('assert');
const DeviceSetModule = require("../lib/device_set.js")

class AccessoryInformation {
  constructor() {
    this.properties = {}
  }
  setCharacteristic(characteristic, value) {
    this.properties[characteristic] = value
    return this;
  }
}
class Characteristic {
  constructor(name) {
    this._on = {}
  }

  on(key, fn) {
    this._on[key] = fn
    return this;
  }
  updateValue(value) {
    this.value = value
  }
}
class ContactSensor {
  constructor(name) {
    this.name = name
    this.characteristics = {
      ContactSensorState: new Characteristic()
    }
  }
  getCharacteristic(characteristic) {
    return this.characteristics[characteristic.name]
  }
  setCharacteristic(characteristic, value) {
    this.characteristics[characteristic.name] = value
    return this
  }
}
const MockHomebridge = {
  hap: {
    Service: {
      AccessoryInformation: AccessoryInformation,
      ContactSensor: ContactSensor
    },
    Characteristic: {
      Manufacturer: {name: "Manufacturer"},
      Model: {name: "Model"},
      SerialNumber: {name: "SerialNumber"},
      ContactSensorState: {name: "ContactSensorState", CONTACT_DETECTED: "CONTACT_DETECTED", CONTACT_NOT_DETECTED: "CONTACT_NOT_DETECTED"},
    }
  }
}

const DeviceSet = DeviceSetModule({}, console.log, MockHomebridge, {})

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
      var deviceSet = new DeviceSet([mockWindowSensor, mockDoorSensor])
      assert.equal(2, deviceSet.devices.length)
      assert.equal("DoorWindowSensor", deviceSet.devicesById[28].getType())
      assert.equal("DoorWindowSensor", deviceSet.devicesById[42].getType())
    });
  });

  describe('#handleMessage', function() {
    it("updates the data and publishes an update to homebridge", function() {
      var deviceSet = new DeviceSet([mockWindowSensor, mockDoorSensor])
      var basementShopWindow = deviceSet.devicesById[42]
      let services = deviceSet.devices.map((device) => device.getServices()).reduce((a,b) => a.concat(b))
      let Characteristic = MockHomebridge.hap.Characteristic

      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_DETECTED);
      deviceSet.handleMessage({
        message: {
          _id:"13|1",
          da:{d:[{_id:42,s:true}],plctx:{ts:"2018-06-16T06:59:09.198000"}},
          op:"u",
          panid:13,
          parid:1,
          t:"account_partition"}})
      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    })
  });
});
