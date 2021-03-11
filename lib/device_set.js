const VivintDict = require("./vivint_dictionary.json")

const ContactSensor = require("./accessories/contact_sensor.js")
const SmokeSensor = require("./accessories/smoke_sensor.js")
const CarbonMonoxideSensor = require("./accessories/carbon_monoxide_sensor.js")
const MotionSensor = require("./accessories/motion_sensor.js")
const Lock = require("./accessories/lock.js")
const Thermostat = require("./accessories/thermostat.js")
const GarageDoor = require("./accessories/garage_door.js")
const Panel = require("./accessories/panel.js")
const Camera = require("./accessories/camera.js")
const LightSwitch = require("./accessories/light_switch.js")
const DimmerSwitch = require("./accessories/dimmer_switch.js")

function DeviceSetModule(config, log, homebridge, vivintApi) {
  let PlatformAccessory = homebridge.platformAccessory
  let Service = homebridge.hap.Service
  let Accessory = homebridge.hap.Accessory
  let Characteristic = homebridge.hap.Characteristic
  let uuid = homebridge.hap.uuid

  let config_IgnoredDeviceTypes = config.ignoreDeviceTypes || []

  class DeviceSet {
    constructor() {
      this.lastSnapshotTime = 0
      this.devices = []
      this.devicesById = {}
      this.panel_DeviceId = 0
    }

    bindAccessory(accessory, data) {

      let deviceClass = Devices.find((dc) => {
        return dc.name == accessory.context.deviceClassName
      })
      if (!deviceClass)
        throw "Unknown device class name " + accessory.context.deviceClassName

      let device = new deviceClass(accessory, data, config, log, homebridge, vivintApi)
      this.devices.push(device)
      this.devicesById[device.id] = device

      if (accessory.context.deviceClassName === "Panel") this.panel_DeviceId = device.id
    }

    handleSnapshot(deviceData, timestamp) {
      this.lastSnapshotTime = timestamp
      log.debug(`Handling incoming device snapshot for timestamp ${timestamp}`)

      //Move Security Status value to the Panel device
      let panelData = deviceData.Devices.find((dvc) => dvc.Id == this.panel_DeviceId)
      if (panelData !== null) {
        panelData.Status = deviceData.Status
      }

      for (let _deviceId in this.devicesById) {             
        let deviceId = parseInt(_deviceId)
        let data = deviceData.Devices.find((dvc) => dvc.Id == deviceId)

        if (data) this.devicesById[_deviceId].handleSnapshot(data)
      }
    }

    handleMessage(message) {
      if (message.Data) {
        if (message.Data.PlatformContext.Timestamp < this.lastSnapshotTime) {
          log.warn("Ignoring stale update", message.Data.PlatformContext.Timestamp, "<", this.lastSnapshotTime)
          return;
        }

        //Panel
        if (message.Id === vivintApi.panelId && message.Data.Status != undefined) {
          //Move Security Status value to the Panel device
          message.Data.Devices = [{
            Id: this.panel_DeviceId,
            Status: message.Data.Status
          }]
        }
        //Jammed lock notification
        else if (message.Type === VivintDict.ObjectType.InboxMessage && message.Data != null && message.Data.Subject != null && message.Data.Subject.indexOf('failed to lock') !== -1){
          const lockName = message.Data.Subject.split('Alert: ')[1].split(' failed to lock')[0]
          var lockDevice = this.devices.find(device => {
            return device.data.Type === VivintDict.PanelDeviceType.DoorLock && device.name === lockName
          })
          if (lockDevice) {
            message.Data.Devices = [{
              Id: lockDevice.data.Id,
              Status: Characteristic.LockCurrentState.JAMMED
            }]
          }
        }

        if (message.Data.Devices) {
          message.Data.Devices.forEach((patch) => {
            if (this.devicesById[patch.Id]) {
              this.devicesById[patch.Id].handlePatch(patch)
            }
          })
        }
      }
    }
    
    static createDeviceAccessory(data) {
      let deviceClass = Devices.find((dc) => {
        return dc.appliesTo(data)
      })

      //These device types are not useable for HomeKit purposes
      const irrelevantDeviceTypes = ['sensor_group','network_hosts_service','panel_diagnostics_service','iot_service','scheduler_service','yofi_device','keyfob_device']
      if (irrelevantDeviceTypes.indexOf(data.Type) != -1) {
        log.debug(`Ignored unuseable device [Type]:${data.Type} [Data]:`, JSON.stringify(data, undefined, 4))
        return null
      }

      if (!deviceClass) {
        log.info(`Device not (yet) supported [ID]:${data.Id} [Type]:${data.Type} [EquipmentCode]:${data.EquipmentCode} [Name]:${data.Name}`)
        log.debug('Unsupported device found! [Data]:', JSON.stringify(data, undefined, 4))
        return null
      }

      if (config_IgnoredDeviceTypes.indexOf(data.Type) != -1) {
        log.info(`Ignored device [ID]:${data.Id} [Type]:${data.Type} [EquipmentCode]:${data.EquipmentCode} [Name]:${data.Name}`)
        return null
      }

      let serial = (data.SerialNumber32Bit || 0).toString(16).padStart(8, '0') + ':' + (data.SerialNumber || 0).toString(16).padStart(8, '0') + ':' + data.Id

      let category = deviceClass.inferCategory && deviceClass.inferCategory(data, Accessory) || Accessory.Categories.OTHER

      var manufacturer = "Vivint"
      var model = data.EquipmentCode !== undefined ? vivintApi.getDictionaryKeyByValue(VivintDict.EquipmentCode, data.EquipmentCode) : deviceClass.name

      //For non-Vivint devices override values 
      if (data.ActualType) {
        let splittedName = data.ActualType.split('_')
        if (splittedName.length > 0) {
          manufacturer = splittedName[0].toUpperCase()
        }
        if (splittedName.length > 1) {
          model = splittedName[1].toUpperCase()
        }
      }

      let accessory = new PlatformAccessory(
        data.Name,
        uuid.generate("Vivint:" + data.Id + ":" + serial),
        category)

      accessory.context.name = data.Name
      accessory.context.id = data.Id
      accessory.context.deviceClassName = deviceClass.name

      let informationService = accessory.getService(Service.AccessoryInformation)
      informationService
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial)

      if (data.CurrentSoftwareVersion || data.SoftwareVersion){
        informationService
          .setCharacteristic(Characteristic.FirmwareRevision, data.CurrentSoftwareVersion || data.SoftwareVersion)
      }

      deviceClass.addServices(accessory, Service, config)

      return accessory
    }
  }

  let Devices = [ContactSensor, SmokeSensor, CarbonMonoxideSensor, MotionSensor, Lock, Thermostat, GarageDoor, Panel, Camera, LightSwitch, DimmerSwitch]
  return DeviceSet
}

module.exports = DeviceSetModule
