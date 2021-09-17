var Accessory, Service, Characteristic, UUIDGen;

const PluginName = "homebridge-vivint"
const PlatformName = "Vivint"
const VivintApiModule = require("./lib/vivint_api.js")
const DeviceSetModule = require("./lib/device_set.js")

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  function setCatastrophe(accessories) {
    accessories.forEach((accessory) => {
      accessory.services
      .filter((service) => service.UUID != Service.AccessoryInformation)
      .forEach((service) => {
        service.characteristics.forEach((characteristic) => {
          characteristic.on('get', (next) => {
            next(new Error("Platform failed to initialize"))
          })
        })
      })
    })
  }

  class VivintPlatform {
    constructor(log, config, api) {
      this.log = log
      this.config = config
      this.api = api
      this.cachedAccessories = []

      let config_apiLoginRefreshSecs = config.apiLoginRefreshSecs || 1200 // once per 20 minutes default

      let VivintApi = VivintApiModule(config, log)
      this.vivintApiPromise = VivintApi.login({refreshToken: config.refreshToken})
      
      this.pubNubPromise = this.vivintApiPromise
        .then((vivintApi) => vivintApi.connectPubNub())

      this.initialLoad = 
          Promise.all([this.vivintApiPromise, this.pubNubPromise, this.cachedAccessories])
          .then(
            ([vivintApi, pubNub, cachedAccessories]) => {
              let DeviceSet = DeviceSetModule(config, log, homebridge, vivintApi)
              let deviceSet = new DeviceSet()

              this.log.debug(JSON.stringify(vivintApi.deviceSnapshot(), undefined, 4))

              let snapshotDevices = vivintApi.deviceSnapshot().Devices
              let snapshotAccessories = snapshotDevices
                  .filter((data) => data.Id)
                  .map((deviceData) => DeviceSet.createDeviceAccessory(deviceData))
                  .filter((dvc) => dvc)
    
              //Remove stale/ignored accessories                  
              let removedAccessories = cachedAccessories
                  .filter((acc) => !snapshotAccessories.some((snap_acc) => snap_acc.context.id === acc.context.id))
              //Remove accessories that are handled differently (and previously enabled cameras if disabled now)
              let changedAccessories = cachedAccessories
                  .filter((acc) => snapshotAccessories.some((snap_acc) => snap_acc.context.id === acc.context.id && snap_acc.context.deviceClassName !== acc.context.deviceClassName || config.disableCameras && acc.getService(Service.CameraRTPStreamManagement)))
              let removedAndChangedAccessories = removedAccessories.concat(changedAccessories)
              log.info(`Removing ${removedAndChangedAccessories.length} accessories`)
              api.unregisterPlatformAccessories(PluginName, PlatformName, removedAndChangedAccessories)

              //Adding new accessories
              let newAccessories = snapshotAccessories
                  .filter((acc) => !cachedAccessories.some((cached_acc) => cached_acc.context.id === acc.context.id) || changedAccessories.some((changed_acc) => changed_acc.context.id === acc.context.id))
              log.info(`Adding ${newAccessories.length} accessories`)
              api.registerPlatformAccessories(PluginName, PlatformName, newAccessories)
    
              cachedAccessories = cachedAccessories.filter((el) => !removedAccessories.includes(el));

              cachedAccessories.forEach((accessory) => { 
                let data = snapshotDevices.find((snap_device) => snap_device.Id === accessory.context.id)
                deviceSet.bindAccessory(accessory, data) 
              })

              newAccessories.forEach((accessory) => { 
                let data = snapshotDevices.find((snap_device) => snap_device.Id === accessory.context.id)
                deviceSet.bindAccessory(accessory, data) 
              })
    
              pubNub.addListener({
                status: function(statusEvent) {
                  switch(statusEvent.category){
                    case 'PNConnectedCategory':
                      log.debug("Connected to Pubnub")
                      break
                    case 'PNReconnectedCategory':
                      log.warn("Reconnected to Pubnub")
                      break
                    default:
                      log.warn("Could not connect to Pubnub, reconnecting...")
                      log.error(statusEvent)
                  }
                },
                message: function(msg) {
                  log.debug("Parsed PubNub message:", JSON.stringify(vivintApi.parsePubNub(msg.message), undefined, 4))
                  deviceSet.handleMessage(vivintApi.parsePubNub(msg.message))
                }
              })
              deviceSet.handleSnapshot(vivintApi.deviceSnapshot(), vivintApi.deviceSnapshotTs())

              //Refreshing the token
              setInterval(() => {
                vivintApi.renew()
                  .then((vivintApi) => vivintApi.renewPanelLogin())
                  .catch((err) => log.error("Error refreshing login info:", err))
              }, config_apiLoginRefreshSecs * 1000)

              //Setting up the system info refresh to keep the notification stream active
              setInterval(() => {
                  vivintApi.renewSystemInfo()
                    .then((vivintApi) => deviceSet.handleSnapshot(vivintApi.deviceSnapshot(), vivintApi.deviceSnapshotTs()))
                    .catch((err) => log.error("Error getting system info:", err))
              }, (config_apiLoginRefreshSecs / 20) * 1000)
            }
          ).catch((error) => {
            log.error("Error while bootstrapping accessories:", error)
            Promise.all(this.cachedAccessories).then(setCatastrophe)
          })

      api.on('didFinishLaunching', () => { 
        return this.initialLoad
      })
    }

    configureAccessory(accessory) {
      this.cachedAccessories.push(accessory)
    }
  }

  homebridge.registerPlatform(PluginName, PlatformName, VivintPlatform)
};
