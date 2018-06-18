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
    uuid: { generate: (input) => input },
    Service: {
      AccessoryInformation: AccessoryInformation,
      ContactSensor: ContactSensor
    },
    Characteristic: {
      Manufacturer: {name: "Manufacturer"},
      Model: {name: "Model"},
      SerialNumber: {name: "SerialNumber"},
      ContactSensorState: {name: "ContactSensorState", CONTACT_DETECTED: "CONTACT_DETECTED", CONTACT_NOT_DETECTED: "CONTACT_NOT_DETECTED"},
      LockTargetState: {name: "LockTargetState", SECURED: "SECURED", UNSECURED: "UNSECURED"}
    }
  }
}

const DeviceSet = DeviceSetModule({}, console.log, MockHomebridge, {})

let mockDoorSensor = () => ({
  "_id": 28,
  "vd": ["Back Door"],
  "n": "Back Door",
  "ser": 193001,
  "ser32": 16970217,
  "ch": 1,
  "t": "wireless_sensor",
  "s": false,
  "cc": true, "cb": true, "ea": true, "ec": 1251, "eqt": 1, "set": 1, "pnlctx": {"ts": "2018-06-16T05:03:49.230000"},
  "er": 1, "lb": false, "icz": false, "ln": 2, "tr": false, "ts": "2018-06-16T05:03:49.230000", "plctx": {"ts":
  "2018-06-16T05:03:49.230000"}, "from_sync": 1, "re": true, "zid": 3, "sup": false, "panid": 13, "ta": false, "suv":
  true, "dd": false, "b": 0, "ccz": false, "v": true,
})

let mockWindowSensor = () => ({
  "_id": 42,
  "vd": ["Basement", "Shop", "Window"],
  "ch": 1,
  "ser": 192977,
  "ser32": 16970193,
  "n": "Basement Shop Window",
  "t": "wireless_sensor",
  "s": false,
  "cc": true, "cb": true, "ea": true, "ec": 1251, "eqt": 1, "set": 3, "pnlctx": {"ts": "2018-06-10T03:04:46.059000"},
  "er": 1, "lb": false, "icz": false, "ln": 2, "tr": false, "ts": "2018-06-10T03:04:46.059000", "plctx": {"ts":
  "2018-06-10T03:04:46.059000"}, "from_sync": 1, "re": true, "zid": 17, "sup": false, "panid": 13, "ta": false, "suv":
  true, "dd": false, "b": 0, "ccz": true, "v": true,
})

let mockDoorLock = () => ({
  "_id": 24,
  "n": "Front Door",
  "s": true,
  "t": "door_lock_device",
  "act": "door_lock_device",
  "prid": 1,
  "avn": 3,
  "ia": true,
  "ucl": [18],
  "er": 2,
  "sku": "99100005",
  "lb": false,
  "fea": {"lock_selection": true},
  "ts": "2018-06-16T05:07:38.527000",
  "plctx": {"ts": "2018-06-16T05:07:38.527000"},
  "from_sync": 1,
  "asvn": 37,
  "panid": 13,
  "prtid": 1,
  "zpd": "4.55",
  "opfp": 19,
  "bl": 50,
  "avsl": 29,
  "nid": 2,
  "opfc": 948,
  "opc": 4817,
  "hwv": 0,
  "dt": 10,
  "nonl": true,
  "isl": false,
  "caca": [{"ca": [22], "t": 5}, {"ca": [30], "t": 7}, {"ca": [31], "t": 8}],
  "pnlctx": {"operation_type": 1, "ts": "2018-06-16T05:07:38.527000"},
  "op": 1
})

describe('DeviceSet', function() {
  snapshotTs_earlier = "2018-06-16T06:58:00.999999"
  snapshotTs = "2018-06-16T06:59:00.000000"
  snapshotTs_later = "2018-06-16T06:59:00.000000"
  describe('#constructor', function() {
    it('populates the devices with the given delegators', function() {
      var deviceSet = new DeviceSet([mockWindowSensor(), mockDoorSensor(), mockDoorLock()], snapshotTs)
      assert.equal(3, deviceSet.devices.length)
      assert.equal("DoorWindowSensor", deviceSet.devicesById[28].getType())
      assert.equal("DoorWindowSensor", deviceSet.devicesById[42].getType())
      assert.equal("Lock", deviceSet.devicesById[24].getType())
    });
  });

  describe('#handleSnapshot', function() {
    it("receives a new snapshot of data and publishes to homebridge", function() {
      var deviceSet = new DeviceSet([mockWindowSensor()], snapshotTs)
      var basementShopWindow = deviceSet.devicesById[42]

      let mockWindowSensorNewSnapshot = mockWindowSensor()
      mockWindowSensorNewSnapshot.s = true
      let Characteristic = MockHomebridge.hap.Characteristic

      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_DETECTED);
      deviceSet.handleSnapshot([mockWindowSensorNewSnapshot], snapshotTs_later)
      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    })
  });
  describe('#handleMessage', function() {
    it("updates the data and publishes an update to homebridge", function() {
      var deviceSet = new DeviceSet([mockWindowSensor(), mockDoorSensor()], snapshotTs)
      var basementShopWindow = deviceSet.devicesById[42]
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

    it("ignores messages originating before the current snapshot", function() {
      var deviceSet = new DeviceSet([mockWindowSensor(), mockDoorSensor()], snapshotTs)
      console.log(deviceSet)
      var basementShopWindow = deviceSet.devicesById[42]
      let Characteristic = MockHomebridge.hap.Characteristic

      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_DETECTED);
      deviceSet.handleMessage(
        {
          message: {
            _id:"13|1",
            da:{d:[{_id:42,s:true}],plctx:{ts:snapshotTs_earlier}},
            op:"u",
            panid:13,
            parid:1,
            t:"account_partition"}},
        "2018-06-16T06:58:00.999999")
      assert.equal(basementShopWindow.contactSensorValue(), Characteristic.ContactSensorState.CONTACT_DETECTED);
    })
  });
});
