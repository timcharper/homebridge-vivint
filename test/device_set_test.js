const assert = require('assert');
const DeviceSetModule = require("../lib/device_set.js")

class MockService {
  constructor(name) {
    this.name = name
    this.characteristics = {}
    this._mockClassName = this.constructor.name
  }
  getCharacteristic(characteristic) {
    if (!(characteristic.name in this.characteristics))
      this.characteristics[characteristic.name] = new Characteristic(characteristic)
    return this.characteristics[characteristic.name]
  }
  setCharacteristic(characteristic, value) {
    this.characteristics[characteristic.name] = value
    return this
  }
}

class MockPlatformAccessory {
  constructor(name, uuid, category) {
    this.name = name
    this.uuid = uuid
    this.category = category
    this.context = {}
    this.services = []
    this.addService(new AccessoryInformation)
  }

  addService(service) {
    this.services.push(service)
  }

  getServiceByUUIDAndSubType(mockServiceClass, subtype) {
    return this.services.find((service) => {
      return service._mockClassName == mockServiceClass.name
    })
  }
}

class Characteristic {
  constructor(char) {
    this.name = char.name
    this.characteristic = char
    this._on = {}
  }

  on(key, fn) {
    this._on[key] = fn
    return this;
  }

  triggerGetSync() {
    var result
    this._on['get']((err, r) => result =r )
    return result
  }

  updateValue(value) {
    this.value = value
  }
}

class AccessoryInformation extends MockService {}
class MotionSensor extends MockService {}
class OccupancySensor extends MockService {}
class ContactSensor extends MockService {}
class LockMechanism extends MockService {}
const MockHomebridge = {
  platformAccessory: MockPlatformAccessory,
  hap: {
    uuid: { generate: (input) => input },
    Service: {
      AccessoryInformation: AccessoryInformation,
      ContactSensor: ContactSensor,
      MotionSensor: MotionSensor,
      LockMechanism: LockMechanism,
      OccupancySensor: OccupancySensor
    },
    Accessory: {
      Categories: {
        OTHER: "OTHER",
        DOOR: "DOOR",
        WINDOW: "WINDOW"
      }
    },
    Characteristic: {
      Manufacturer: {name: "Manufacturer"},
      Model: {name: "Model"},
      SerialNumber: {name: "SerialNumber"},
      ContactSensorState: {name: "ContactSensorState", CONTACT_DETECTED: "CONTACT_DETECTED", CONTACT_NOT_DETECTED: "CONTACT_NOT_DETECTED"},
      LockCurrentState: {name: "LockCurrentState", SECURED: "LCS_SECURED", UNSECURED: "LCS_UNSECURED"},
      LockTargetState: {name: "LockTargetState", SECURED: "LTS_SECURED", UNSECURED: "LTS_UNSECURED"},
      MotionDetected: {name: "MotionDetected", SECURED: "SECURED", UNSECURED: "UNSECURED"},
      OccupancyDetected: {name: "OccupancyDetected", OCCUPANCY_DETECTED: 'OCCUPANCY_DETECTED', OCCUPANCY_NOT_DETECTED: 'OCCUPANCY_NOT_DETECTED' }
    }
  }
}

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

let mockMotionSensor = () => ({
  "_id": 45,
  "vd": ["Family", "Room", "Motion", "Sensor"],
  "ch": 1,
  "ser": 192977,
  "ser32": 16970193,
  "n": "Family Room Motion Sensor",
  "t": "wireless_sensor",
  "s": false,
  "cc": true, "cb": true, "ea": true, "ec": 1249, "eqt": 1, "set": 3, "pnlctx": {"ts": "2018-06-10T03:04:46.059000"},
  "er": 1, "lb": false, "icz": false, "ln": 2, "tr": false, "ts": "2018-06-10T03:04:46.059000", "plctx": {"ts":
  "2018-06-10T03:04:46.059000"}, "from_sync": 1, "re": true, "zid": 17, "sup": false, "panid": 13, "ta": false, "suv":
  true, "dd": false, "b": 0, "ccz": true, "v": true,
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
  var DeviceSet
  var MockSetInterval
  var MockDate
  let Characteristic = MockHomebridge.hap.Characteristic
  let Service = MockHomebridge.hap.Service
  let motionDetectedOccupancySensorMins = 1

  let deviceSetFromData = (data, ts) => {
    let deviceSet = new DeviceSet()
    data.forEach((deviceData) => {
      let accessory = DeviceSet.createDeviceAccessory(deviceData)
      deviceSet.bindAccessory(accessory)
    })
    deviceSet.handleSnapshot(data, snapshotTs)
    return deviceSet
  }

  beforeEach(() => {
    let timers = []
    MockSetInterval = function(fn, frequency) {
      timers.push({fn, frequency})
    }
    MockSetInterval.getTimers = () => timers
    MockSetInterval.clear = () => { timers = [] }
    MockDate = {
      currentTime: 1529629810000,
      now: () => MockDate.currentTime
    }
    DeviceSet = DeviceSetModule({motionDetectedOccupancySensorMins}, console.log, MockHomebridge, {}, {}, MockSetInterval, MockDate)
  })

  describe('#constructor', function() {
    it('populates the devices with the given delegators', function() {
      var deviceSet = deviceSetFromData([mockWindowSensor(), mockDoorSensor(), mockDoorLock()], snapshotTs)
      assert.equal(3, deviceSet.devices.length)
      console.log(deviceSet)
      assert.equal("ContactSensor", deviceSet.devicesById[28].constructor.name)
      assert.equal("ContactSensor", deviceSet.devicesById[42].constructor.name)
      assert.equal("Lock", deviceSet.devicesById[24].constructor.name)
    });
  });

  describe("#motionSensorOccupancy", function() {
    it('turns on occupancy sensor for the configured duration when the motion sensor actives', () => {
      var deviceSet = deviceSetFromData([mockMotionSensor()])
      let motionSensor = deviceSet.devicesById[45]
      let occupancy = motionSensor.occupancyService
      let occupancyDetected = occupancy.getCharacteristic(Characteristic.OccupancyDetected)
      assert.equal(1, MockSetInterval.getTimers().length)
      let occupancyInterval = MockSetInterval.getTimers()[0]
      assert.equal(60000, occupancyInterval.frequency)

      // defaults to off

      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED, occupancyDetected.triggerGetSync())

      // sense motion
      deviceSet.handleMessage({
        message: {
          da:{d:[{_id:45,s:true}], plctx:{ts:"2018-06-16T06:59:09.198000"}}}})

      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED, occupancyDetected.value)
      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED, occupancyDetected.triggerGetSync())

      // trigger at just before the duration
      MockDate.currentTime += (motionDetectedOccupancySensorMins * 60 * 1000) - 1
      occupancyInterval.fn()

      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED, occupancyDetected.value)
      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_DETECTED, occupancyDetected.triggerGetSync())

      // trigger at the duration
      MockDate.currentTime += 1
      occupancyInterval.fn()

      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED, occupancyDetected.value)
      assert.equal(Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED, occupancyDetected.triggerGetSync())
    })
  })

  describe('#handleSnapshot', function() {
    it("receives a new snapshot of data and publishes to homebridge", function() {
      var deviceSet = deviceSetFromData([mockWindowSensor()], snapshotTs)
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
      var deviceSet = deviceSetFromData([mockWindowSensor(), mockDoorSensor()], snapshotTs)
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
      var deviceSet = deviceSetFromData([mockWindowSensor(), mockDoorSensor()], snapshotTs)
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
