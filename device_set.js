const dataPatch = require("../lib/datapatch.js")
const debounce = require("debounce-promise")
const extend = require('util')._extend

function serialNumber(ser, ser32) {
  return (ser32 || 0).toString(16).padStart(8, '0') + ':' +
    (ser || 0).toString(16).padStart(8, '0')
}

function DeviceSetModule(config, log, homebridge, vivintApi, ThermostatCharacteristics, setInterval, Date) {
  let PlatformAccessory = homebridge.platformAccessory;
  let Service = homebridge.hap.Service;
  let Accessory = homebridge.hap.Accessory;
  let Characteristic = homebridge.hap.Characteristic;
  let uuid = homebridge.hap.uuid;
  let temperatureUnits = (config.temperatureUnits || "f").toLowerCase()

  let motionDetectedOccupancySensorMs = (config.motionDetectedOccupancySensorMins || 0) * 60 * 1000

  if (temperatureUnits != "c" && temperatureUnits != "f") {
    throw "config.temperatureUnits must be 'c' or 'f'; got this instead: " + temperatureUnits
  }

  class DeviceSet {
    constructor() {
      // deviceData = systemInfo.system.par[0].d
      this.lastSnapshotTime = 0
      this.devices = []
      this.devicesById = {}
      this.panel_Id = 0
    }

    bindAccessory(accessory) {
      let deviceClass = Devices.find((dc) => { return dc.name == accessory.context.deviceClassName })
      if (!deviceClass)
        throw "Unknown device class name " + accessory.context.deviceClassName

      let device = new deviceClass(accessory)
      this.devices.push(device)
      this.devicesById[device.id] = device

      if (accessory.context.deviceClassName === "Panel") this.panel_Id = device.id
    }

    handleSnapshot(deviceData, timestamp) {
      this.lastSnapshotTime = timestamp
      log("Handling incoming device snapshot for timestamp", timestamp)

      for (let _deviceId in this.devicesById) {
        let deviceId = parseInt(_deviceId)
        let d = deviceData.find((dvc) => dvc._id == deviceId)
        if (d) this.devicesById[_deviceId].handleSnapshot(d)
      }
      
      
      // update armed status
      let m = {}
      m.message = {
      	 _id: this.panel_Id,
         s: vivintApi.systemInfo.system.s, 
         stateupdate: true,
         newstate: vivintApi.systemInfo.system.s,
         da: {
	         plctx: {
		         ts: 0
	         }
         }
      }

      if (vivintApi.systemInfo.system.s === 0) m.message.da.secd = { s: vivintApi.systemInfo.system.s }
      else m.message.da.seca = { s: vivintApi.systemInfo.system.s }
    

      this.handleMessage(m)  
      
      // end update arm status    
    }

    handleMessage(msg) {
     
     if (msg.message.da.seca) {
         // we get here by the security being armed
         msg.message.da.d = []
         msg.message.da.d[0] = {
	         _id: this.panel_Id,
	         s: msg.message.da.seca.s, 
	         stateupdate: true,
	         newstate: msg.message.da.seca.s 
         }
         
         //log("Received ARM message: " + msg.message.da.seca.s)
    } else if (msg.message.da.secd) {
         // we get here by the security being disarmed
         msg.message.da.d = []
         msg.message.da.d[0] = {
	         _id: this.panel_Id,
	         s: msg.message.da.secd.s, 
	         stateupdate: true,
	         newstate: msg.message.da.secd.s 	    
	     }     
	     
	     //log("Received DISARM message: " + msg.message.da.secd.s)
    }



	 if ((msg.message.da) && (msg.message.da.d)) {
	    if (msg.message.da.plctx.ts < this.lastSnapshotTime) {
	      log("Ignoring stale update", msg.message.da.plctx.ts, "<", this.lastSnapshotTime)
	      return;
	    }
	    msg.message.da.d.forEach((patch) => {
	      if (this.devicesById[patch._id]) {
	        this.devicesById[patch._id].handlePatch(patch)
	        
	      }
	    })
	  }

      
    }
  }

  class Device {
    constructor(accessory) {
      this.id = accessory.context.id
      this.name = accessory.context.name
      this.data = {}
    }

    handleSnapshot(data) {
      if (data._id != this.id)
        throw "This snapshot does not belong to this device"
      this.data = data
      this.notify()
    }

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      if (patch._id != this.id)
        throw "This patch does not belong to this device"

      dataPatch(this.data, patch)
      this.notify()
    }

    notify() {
      throw new("notify not implemented")
    }
  }

  extend(DeviceSet, {
    createDeviceAccessory: (data) => {
      let deviceClass = Devices.find((dc) => { return dc.appliesTo(data) })
      if (!deviceClass) {
        log("Do not know how to handle device! ID: " + data._id + " Data.t: " + data.t + " data.ec: " + data.ec + " Data.n: " + data.n)
        return null // we don't know how to handle this device.
      }


      let name = data.n
      let id = data._id
      let serial = serialNumber(data.ser, data.ser32)
      let category = deviceClass.inferCategory && deviceClass.inferCategory(data) || Accessory.Categories.OTHER

      let accessory = new PlatformAccessory(
        name,
        uuid.generate("Vivint:" + id + ":" + serial),
        category) // setting category doesn't seem to work :'(

      accessory.context.name = name
      accessory.context.id = data._id
      accessory.context.deviceClassName = deviceClass.name


      let informationService = accessory.getServiceByUUIDAndSubType(Service.AccessoryInformation)

      informationService
        .setCharacteristic(Characteristic.Manufacturer, "Vivint")
        .setCharacteristic(Characteristic.Model, deviceClass.name)
        .setCharacteristic(Characteristic.SerialNumber, serial);
      
      deviceClass.addServices(accessory)
      return accessory
    }
  })

  class ContactSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)

      this.service
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', (next) => next(null, this.contactSensorValue()));
    }

    contactSensorValue() {
      if (this.data.s)
        return Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      else
        return Characteristic.ContactSensorState.CONTACT_DETECTED
    }
    
    contactBatteryLevelValue() {
	    return this.data.bl
    }

    notify() {
      if (this.contactBatteryLevelValue()) {
	      if (0 <= this.contactBatteryLevelValue() && this.contactBatteryLevelValue() <= 10) {
		      this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
		  }
		  else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
		  
		  this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.contactBatteryLevelValue())
		  this.serviceb.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)
		  
      }	  
	    
      this.service.getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(this.contactSensorValue())
    }
  }

  extend(ContactSensor, {
    appliesTo: (data) => {
      return((data.t == "wireless_sensor") && ((data.ec == 1252) || (data.ec == 1251)))
    },
    inferCategory: (data) => {
      let name = data.n
      
      if (name.match(/\bwindow\b/i))
        return Accessory.Categories.WINDOW
      else if (name.match(/\bdoor(way)?\b/i))
        return Accessory.Categories.DOOR
      else
        return Accessory.Categories.OTHER
    },
    addServices: (accessory) => {
      accessory.addService(new Service.ContactSensor(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))
    }
  })
  
  class PIVMotion extends Device {
	  constructor(accessory) {
		  super(accessory)
		  this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)
		  
		  this.service
		  	.getCharacteristic(Characteristic.MotionDetected)
		  	.on('get', (next) => next(null, this.motionpivDetectedValue()))
	  }
	  
	  motionpivDetectedValue() {
		  return this.data.piv || this.data.vdt
	  }
	  
	  notify() {
		  this.service.getCharacteristic(Characteristic.MotionDetected)
		  	.updateValue(this.motionpivDetectedValue())
		  
		  if (this.data.vdt) {
			  // the doorbell uses the flag "VDT" and doesn't reset itself for some reason
			  setTimeout(
			    this.service.getCharacteristic(Characteristic.MotionDetected).updateValue(0),
			    5000
			  )	
		  }
		  //log("Updated camera motion PIV: " + this.motionpivDetectedValue())
	  }
  }
  extend(PIVMotion, {
	  appliesTo: (data) => { return (data.t == "camera_device") },
	  addServices: (accessory) => { accessory.addService(new Service.MotionSensor(accessory.context.name + " PIV Detector")) }
  })

  class MotionSensor extends Device {
    constructor(accessory) {
      super(accessory)
      this.lastSensedMotion = null;
      this.service = accessory.getServiceByUUIDAndSubType(Service.MotionSensor)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)
      this.occupancyService = accessory.getServiceByUUIDAndSubType(Service.OccupancySensor)

      this.service
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', (next) => next(null, this.motionDetectedValue()));

      if (this.occupancyService) {
        this.notifyOccupancy()
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .on('get', (next) => next(null, this.occupancyValue()))

        setInterval(() => this.notifyOccupancy(), 60 * 1000);
      }
    }

    notifyOccupancy() {
      if (this.occupancyService) {
        this.occupancyService
          .getCharacteristic(Characteristic.OccupancyDetected)
          .updateValue(this.occupancyValue())
      }
    }

    occupancyValue() {
      if (this.lastSensedMotion == null)
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      let lastSensedDuration = Date.now() - this.lastSensedMotion
      if (lastSensedDuration < motionDetectedOccupancySensorMs)
        return Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      else
        return Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
    }

    motionDetectedValue() {
      return this.data.s
    }
    
    motionBatteryLevelValue() {
	    return this.data.bl
    }
    
    notify() {
      if (this.motionDetectedValue()) {
        this.lastSensedMotion = Date.now()
      }
      
      if (this.motionBatteryLevelValue()) {
	      if (0 <= this.motionBatteryLevelValue() && this.motionBatteryLevelValue() <= 10) {
		      this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
		  }
		  else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
		  
		  this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.motionBatteryLevelValue())
		  this.serviceb.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)		  
      }
      
      this.service.getCharacteristic(Characteristic.MotionDetected)
        .updateValue(this.motionDetectedValue())
      this.notifyOccupancy()
    }
  }
  extend(MotionSensor, {
    appliesTo: (data) => {
      return((data.t == "wireless_sensor") && ((data.ec == 1249) || (data.ec == 1249)))
    },
    addServices: (accessory) => {
      accessory.addService(new Service.MotionSensor(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))

      if (motionDetectedOccupancySensorMs > 0) {
        accessory.addService(new Service.OccupancySensor(accessory.context.name + " Occupancy"))
      }
    }
  })

  class Lock extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.LockMechanism)
      this.serviceb = accessory.getServiceByUUIDAndSubType(Service.BatteryService)

      this.service
        .getCharacteristic(Characteristic.LockCurrentState)
        .on('get', (next) => next(null, this.lockCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.LockTargetState)
        .on('get', (next) => next(null, this.targetLockState || this.inferLockTargetState()))
        .on('set', this.setLockTargetStateCharacteristic.bind(this))
    }

    inferLockTargetState() {
      if (this.data.s)
        return Characteristic.LockTargetState.SECURED
      else
        return Characteristic.LockTargetState.UNSECURED
    }
    
    lockBatteryLevelValue() {
	    return this.data.bl
    }

    setLockTargetStateCharacteristic(targetState, next) {
      let locked = (targetState == Characteristic.LockCurrentState.SECURED)
      this.targetLockState = targetState
      vivintApi.putDevice('locks', this.id, {id: this.id, s: locked})
        .then(
          (success) => next(),
          (failure) => {
            log("failure " + failure)
            next(failure)
          })
    }

    lockCurrentValue() {
      if (this.data.s)
        return Characteristic.LockCurrentState.SECURED
      else
        return Characteristic.LockCurrentState.UNSECURED
    }

    notify() {
      this.targetLockState = this.inferLockTargetState()
      if (this.service) {
        this.service.getCharacteristic(Characteristic.LockCurrentState)
          .updateValue(this.lockCurrentValue())
        this.service.getCharacteristic(Characteristic.LockTargetState)
          .updateValue(this.targetLockState)
      }
      
      if (this.serviceb && this.lockBatteryLevelValue()) {
	    if (0 <= this.lockBatteryLevelValue() && this.lockBatteryLevelValue() <= 10) {
		  this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW)
		}
		else this.serviceb.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL)
	      
	    this.serviceb.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.lockBatteryLevelValue())
	    this.serviceb.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGEABLE)  
	  }    
    }
  }

  extend(Lock, {
    appliesTo: (data) => { return data.t == "door_lock_device" },
    addServices: (accessory) => {
      accessory.addService(new Service.LockMechanism(accessory.context.name))
      accessory.addService(new Service.BatteryService(accessory.context.name))
    }
  })


  // Panel???
  class Panel extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.SecuritySystem)

      this.targetPanelState = Characteristic.SecuritySystemTargetState.DISARMED

      this.service
        .getCharacteristic(Characteristic.SecuritySystemCurrentState)
        .on('get', (next) => next(null, this.ssCurrentValue.bind(this)))

      this.service
        .getCharacteristic(Characteristic.SecuritySystemTargetState)
        .on('get', (next) => next(null, this.targetPanelState))
        .on('set', this.setssTargetState.bind(this))
    }

    setssTargetState(targetState, next) {
	  /****
		  *
		  * Target States include:
		  * 0: ARM STAY
		  * 1: ARM AWAY
		  * 2: ARM NIGHT (Treated as ARM STAY)
		  * 3: DISARM
		  *
		  * HomeKit apparently does not like it if you treat NIGHT_ARM the same as STAY_ARM
		  *
		  ****/


      if (targetState === 3) {
        this.targetPanelState = Characteristic.SecuritySystemTargetState.DISARMED
        
        this.service
          .getCharacteristic(Characteristic.SecuritySystemTargetState)
          .updateValue(Characteristic.SecuritySystemTargetState.DISARMED)
          

        vivintApi.putDevicePanel(0)
           .then(
          	(success) => next(),
		  	(failure) => {
          	  log("failure " + failure)
		  	  next(failure)
          })
      } else if (targetState === 1) {
        this.targetPanelState = Characteristic.SecuritySystemTargetState.AWAY_ARM
        //this.targetPanelState = targetState

         this.service
           .getCharacteristic(Characteristic.SecuritySystemTargetState)
           .updateValue(Characteristic.SecuritySystemTargetState.AWAY_ARM)


        vivintApi.putDevicePanel(4)
          .then(
          	(success) => next(),
		  	(failure) => {
          	  log("failure " + failure)
		  	  next(failure)
          })
      } else if (targetState === 0) {
        this.targetPanelState = Characteristic.SecuritySystemTargetState.STAY_ARM
        //this.targetPanelState = targetState

        this.service
          .getCharacteristic(Characteristic.SecuritySystemTargetState)
          .updateValue(Characteristic.SecuritySystemTargetState.STAY_ARM)

        vivintApi.putDevicePanel(3)
          .then(
          	(success) => next(),
		  	(failure) => {
          	  log("failure " + failure)
		  	  next(failure)
          })        
      } else if (targetState === 2) {
        this.targetPanelState = Characteristic.SecuritySystemTargetState.NIGHT_ARM
        //this.targetPanelState = targetState

        this.service
          .getCharacteristic(Characteristic.SecuritySystemTargetState)
          .updateValue(Characteristic.SecuritySystemTargetState.NIGHT_ARM)

        vivintApi.putDevicePanel(3)
          .then(
          	(success) => next(),
		  	(failure) => {
          	  log("failure " + failure)
		  	  next(failure)
          })    	      
	  } else {
	      // something else happened?
	      //log("Received invalid target state for security system: " + targetState)
	      log("Arm state ignored!")
      }
    }
   
    ssCurrentValue() {
      //this.targetPanelState = this.data.newstate
      //log("ssCurrentValue() called: " + this.data.newstate + " 0=dismarmed, 3=stay_arm, 4=away_arm targetPanelState: " + this.targetPanelState)
      // 0 = disarmed
      // 1 = ?
      // 2 = arming countdown
      // 3 = armed stay
      // 4 = armed away
 
      if (this.data.newstate === 0) {
        //this.targetPanelState = Characteristic.SecuritySystemTargetState.DISARMED
        return Characteristic.SecuritySystemCurrentState.DISARMED
      } else if (this.data.newstate === 3) {
        //this.targetPanelState = Characteristic.SecuritySystemTargetState.STAY_ARM
        if (this.targetPanelState === Characteristic.SecuritySystemTargetState.NIGHT_ARM) return Characteristic.SecuritySystemCurrentState.NIGHT_ARM
        else return Characteristic.SecuritySystemCurrentState.STAY_ARM
      } else if (this.data.newstate === 4) {
        //this.targetPanelState = Characteristic.SecuritySystemTargetState.AWAY_ARM
        return Characteristic.SecuritySystemCurrentState.AWAY_ARM
      } else {
        //this.targetPanelState = Characteristic.SecuritySystemTargetState.DISARMED
        return Characteristic.SecuritySystemCurrentState.DISARMED
      }
    }

    notify() {
      if (this.data.stateupdate) {
        //this.service.setCharacteristic(Characteristic.SecuritySystemCurrentState, this.ssCurrentValue())
        this.service
          .getCharacteristic(Characteristic.SecuritySystemTargetState)
          .updateValue(this.ssCurrentValue())
          
        this.service
          .getCharacteristic(Characteristic.SecuritySystemCurrentState)
          .updateValue(this.ssCurrentValue())
          


        //log("Characteristic.SecuritySystemCurrentState changed")
        //log("data: " + JSON.stringify(this.data))
        //this.targetPanelState = this.ssCurrentValue()
        //log("notify() received for panel, setting current state to: " + this.ssCurrentValue())
      }
    }

  }

  extend(Panel, {
    appliesTo: (data) => { return data.t == "primary_touch_link_device" },
    addServices: (accessory) => {
      accessory.addService(new Service.SecuritySystem(accessory.context.name))
    }
  })


  // wish me luck ....

  class GarageDoor extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.GarageDoorOpener)

      this.service
        .getCharacteristic(Characteristic.CurrentDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()));

      this.service
        .getCharacteristic(Characteristic.TargetDoorState)
        .on('get', (next) => next(null, this.doorCurrentValue()))
        .on('set', this.setDoorTargetStateCharacteristic.bind(this))
    }
 
    setDoorTargetStateCharacteristic(targetState, next) {
      //console.log("setDoorTargetStateCharacteristic: " + targetState + "this.data.s: " + this.data.s)
      // 0 -> open, 1->close

      // 2 = close, 4 = open
      if (targetState) {
	    this.service
	      .getCharacteristic(Characteristic.TargetDoorState)
	      .updateValue(Characteristic.TargetDoorState.OPEN)
	    
        vivintApi.putDevice('door', this.id, {s: 2, _id: this.id})
          .then(
            (success) => next(),
            (failure) => {
              log("failure " + failure)
              next(failure)
            })
      } else {
	    this.service
	      .getCharacteristic(Characteristic.TargetDoorState)
	      .updateValue(Characteristic.TargetDoorState.CLOSED)
	      
        vivintApi.putDevice('door', this.id, {s: 4, _id: this.id})
          .then(
            (success) => next(),
            (failure) => {
              log("failure " + failure)
              next(failure)
            })
        }
    }


    doorCurrentValue() {
      //log("doorCurrentValue() this.data.s: " + this.data.s)

      if (this.data.s === 1)
        return Characteristic.CurrentDoorState.CLOSED
      else if (this.data.s === 2)
        return Characteristic.CurrentDoorState.CLOSING
      else if (this.data.s === 4)
        return Characteristic.CurrentDoorState.OPENING
      else if (this.data.s === 5)
        return Characteristic.CurrentDoorState.OPEN
      else
        return Characteristic.CurrentDoorState.STOPPED     
    }

    notify() {
      if (this.service) {
        this.service.getCharacteristic(Characteristic.CurrentDoorState)
          .updateValue(this.doorCurrentValue())
      }
    }
  }

  extend(GarageDoor, {
    appliesTo: (data) => { return data.t == "garage_door_device" },
    addServices: (accessory) => {
      accessory.addService(new Service.GarageDoorOpener(accessory.context.name))
    }
  })

  // mischief managed



  class Thermostat extends Device {
    constructor(accessory) {
      super(accessory)
      this.service = accessory.getServiceByUUIDAndSubType(Service.Thermostat)
      this.fanService = accessory.getServiceByUUIDAndSubType(Service.Fan)
      
      let self = this
      let getter = function(fn) {
        let bound = fn.bind(self)
        return (next) => {
          let result = bound()
          next(null, result)
        }
      }

      let promiseSetter = function(fn) {
        let boundDebounced = debounce(fn.bind(self), 5000, {leading: true})
        return (value, next) => {
          log("starting fn call value " + fn.name)
          boundDebounced(value).then(
            (result) => {
              log("got success value " + fn.name + " " + result)
              next()
            },
            (failure) => {
              log("failure " + failure)
              next(failure)
            }
          )
        }
      }

      this.service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', getter(this.getCurrentHeatingCoolingState))

      this.service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', getter(this.getTargetHeatingCoolingState))
        .on('set', promiseSetter(this.setTargetHeatingCoolingState))

      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', getter(this.getCurrentTemperature))

      this.service
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', getter(this.getTargetTemperature))
        .on('set', promiseSetter(this.setTargetTemperature))

      this.service
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', getter(this.getCurrentRelativeHumidity))

      this.service
        .getCharacteristic(Characteristic.CoolingThresholdTemperature)
        .on('get', getter(this.getCoolingThresholdTemperature))
        .on('set', promiseSetter(this.setCoolingThresholdTemperature))

      this.service
        .getCharacteristic(Characteristic.HeatingThresholdTemperature)
        .on('get', getter(this.getHeatingThresholdTemperature))
        .on('set', promiseSetter(this.setHeatingThresholdTemperature))

      this.service
        .getCharacteristic(ThermostatCharacteristics.HasLeaf)
        .on('get', getter(this.getHasLeaf))

      this.service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', getter(this.getTemperatureDisplayUnits))


      this.fanService
        .getCharacteristic(Characteristic.On)
        .on('get', getter(this.getFanOn))
        .on('set', promiseSetter(this.setFanOn))
    }

    getCurrentHeatingCoolingState() {
      switch (this.data.os) {
      case 0: return Characteristic.CurrentHeatingCoolingState.OFF
      case 1: return Characteristic.CurrentHeatingCoolingState.HEAT
      case 2: return Characteristic.CurrentHeatingCoolingState.COOL
      }
    }

    getTargetHeatingCoolingState() {
      switch (this.data.om) {
        case 0: return Characteristic.TargetHeatingCoolingState.OFF
        case 1: return Characteristic.TargetHeatingCoolingState.HEAT
        case 2: return Characteristic.TargetHeatingCoolingState.COOL
        case 3: return Characteristic.TargetHeatingCoolingState.AUTO
        case 100: return Characteristic.TargetHeatingCoolingState.AUTO // eco mode
      }
    }

    setTargetHeatingCoolingState(state) {
      var setValue = 0

      switch (state) {
      case Characteristic.TargetHeatingCoolingState.OFF:  setValue = 0; break
      case Characteristic.TargetHeatingCoolingState.HEAT: setValue = 1; break
      case Characteristic.TargetHeatingCoolingState.COOL: setValue = 2; break
      case Characteristic.TargetHeatingCoolingState.AUTO: setValue = 3; break
      }

      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, om: setValue})
    }

    getCurrentTemperature() {
      return this.data.val
    }

    getTargetTemperature() {
      switch (this.getTargetHeatingCoolingState()) {
      case Characteristic.TargetHeatingCoolingState.OFF: return this.getCurrentTemperature()
      case Characteristic.TargetHeatingCoolingState.HEAT: return this.getHeatingThresholdTemperature()
      case Characteristic.TargetHeatingCoolingState.COOL: return this.getCoolingThresholdTemperature()
      case Characteristic.TargetHeatingCoolingState.AUTO: return this.getCurrentTemperature()
      }
    }
    setTargetTemperature(temperature) {
      switch (this.getTargetHeatingCoolingState()) {
      case Characteristic.TargetHeatingCoolingState.OFF: return Promise.reject("Can't set target temperature when thermostat is off")
      case Characteristic.TargetHeatingCoolingState.HEAT:
        return vivintApi.putDevice('thermostats', this.id, {_id: this.id, hsp: temperature, currentAutoMode: 1})
      case Characteristic.TargetHeatingCoolingState.COOL:
        return vivintApi.putDevice('thermostats', this.id, {_id: this.id, csp: temperature, currentAutoMode: 2})
      case Characteristic.TargetHeatingCoolingState.AUTO: return Promise.reject("Can't set target temperature in auto mode")
      }
    }

    getCoolingThresholdTemperature() {
      return this.data.csp;
    }

    setCoolingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, csp: value})
    }

    getHeatingThresholdTemperature() {
      return this.data.hsp;
    }

    setHeatingThresholdTemperature(value) {
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, hsp: value})
    }

    getCurrentRelativeHumidity() {
      return this.data.hmdt
    }

    getHasLeaf() {
      return this.data.om == 100
    }

    getFanOn() {
      return this.data.fs == 1
    }

    setFanOn(fanOn) {
      let setValue = fanOn ? 100 : 0
      return vivintApi.putDevice('thermostats', this.id, {_id: this.id, fm: setValue})
    }

    getTemperatureDisplayUnits () {
      if (temperatureUnits == "f")
        return Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      else
        return Characteristic.TemperatureDisplayUnits.CELSIUS
    }

    notify() {
      this.service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .updateValue(this.getCurrentHeatingCoolingState())

      this.service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .updateValue(this.getTargetHeatingCoolingState())

      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(this.getCurrentTemperature())

      this.service
        .getCharacteristic(Characteristic.TargetTemperature)
        .updateValue(this.getTargetTemperature())

      this.service
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .updateValue(this.getCurrentRelativeHumidity())

      this.service
        .getCharacteristic(Characteristic.CoolingThresholdTemperature)
        .updateValue(this.getCoolingThresholdTemperature())

      this.service
        .getCharacteristic(Characteristic.HeatingThresholdTemperature)
        .updateValue(this.getHeatingThresholdTemperature())

      this.service
        .getCharacteristic(ThermostatCharacteristics.HasLeaf)
        .updateValue(this.getHasLeaf())

      this.service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .updateValue(this.getTemperatureDisplayUnits())

      this.fanService
        .getCharacteristic(Characteristic.On)
        .updateValue(this.getFanOn())
    }

    /**
     * Handle a PubSub patch
     */
    handlePatch(patch) {
      console.log("==================")
      console.log("incoming patch")
      console.log(JSON.stringify(patch))
      console.log("state before")
      console.log(JSON.stringify(this.data))
      super.handlePatch(patch)
      console.log("state after")
      console.log(JSON.stringify(this.data))
    }
  }

  extend(Thermostat, {
    appliesTo: (data) => {
      return data.t == "thermostat_device"
    },
    addServices: (accessory) => {
      accessory.addService(new Service.Thermostat(accessory.context.name))
      accessory.addService(new Service.Fan(accessory.context.name + " fan"))
    }
  })

  let Devices = [ContactSensor, MotionSensor, Lock, Thermostat, GarageDoor, Panel, PIVMotion]
  return DeviceSet
}

module.exports = DeviceSetModule
