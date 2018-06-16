vivint = require("./vivint.js")

class DeviceSet {
  constructor(api, deviceData) {
    // deviceData = systemInfo.system.par[0].d
    this.devices = deviceData
      .map((d) => {
        // console.log(d)
        let dv = Devices.find((device) => { return DoorWindowSensor.appliesTo(d) })
        if (dv)
          return new dv(d)
        else
          return null
      })
      .filter((d) => d != null)
    
  }
}

class Device {
  constructor(data) {
    this.data = data
  }

  getId() { return this.data._id }
  getType() {
    throw "not implemented"
  }

  /**
   * Handle a PubSub message  
   */
  handleUpdate(message) {
    if (message._id != this.data._id)
      throw "This message does not belong to this device"
    
  }
}

class DoorWindowSensor extends Device {
  getType() {
    return "DoorWindowSensor"
  }
}

DoorWindowSensor.appliesTo = function(data) {
  return((data.t == "wireless_sensor") && ((data.ec == 1252) || (data.ec == 1251)))
}

let Devices = [DoorWindowSensor]

module.exports = {
  DeviceSet: DeviceSet,
  applyDataPatchObj: applyDataPatchObj
}
