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

  class VivintPlatform {
    constructor(log, config, api) {
      this.log = log
      this.config = config
      this.api = api
      this.cachedAccessories = []

      let config_apiLoginRefreshSecs = config.apiLoginRefreshSecs || 1200 // once per 20 minutes default

      let VivintApi = VivintApiModule(config, log)
      this.vivintApiPromise = VivintApi.login({username: config.username, password: config.password})

      this.pubNubPromise = this.vivintApiPromise
        .then((vivintApi) => vivintApi.connectPubNub())

      this.initialLoad = 
          Promise.all([this.vivintApiPromise, this.pubNubPromise, this.cachedAccessories]).then(
            ([vivintApi, pubNub, cachedAccessories]) => {
              let DeviceSet = DeviceSetModule(config, log, homebridge, vivintApi)
              let deviceSet = new DeviceSet()

              let snapshotDevices = vivintApi.deviceSnapshot().Devices
              let snapshotAccessories = snapshotDevices
                  .filter((data) => data.Id)
                  .map((deviceData) => DeviceSet.createDeviceAccessory(deviceData))
                  .filter((dvc) => dvc)
    
              let snapshotAccessoriesIds = snapshotAccessories.map((acc) => acc.context.id)
              let removedAccessories = cachedAccessories
                  .filter((acc) => !snapshotAccessoriesIds.includes(acc.context.id))
              
              let cachedIds = cachedAccessories.map((acc) => acc.context.id)
              let newAccessories = snapshotAccessories
                  .filter((acc) => !cachedIds.includes(acc.context.id))
    
              log.info("Removing " + removedAccessories.length + " stale accessories")
              removedAccessories.forEach((acc) => log.debug(acc.context))
    
              log.info("Adding " + newAccessories.length + " new accessories")
              newAccessories.forEach((acc) => log.debug(acc.context))
    
              api.unregisterPlatformAccessories(PluginName, PlatformName, removedAccessories)
              api.registerPlatformAccessories(PluginName, PlatformName, newAccessories)
    
              cachedAccessories = cachedAccessories.filter((el) => !removedAccessories.includes(el));
              cachedAccessories.forEach((accessory) => deviceSet.bindAccessory(accessory))
              newAccessories.forEach((accessory) => deviceSet.bindAccessory(accessory))
    
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
                  log.debug("Parsed PubNub message:", JSON.stringify(vivintApi.parsePubNub(msg.message)))
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
            this.setCatastrophe()
          })

      api.on('didFinishLaunching', () => { 
        return this.initialLoad
      })
    }

    setCatastrophe() {
      this.cachedAccessories
      .forEach((accessory) => {
        accessory.services
        .filter((service) => service.UUID != Service.AccessoryInformation)
        .forEach((service) => {
          service.characteristics.forEach((characteristic) => {
            characteristic.on('get', (callback) => {
              callback(new Error("Platform failed to initialize"))
            })
          })
        })
      })
    }

    configureAccessory(accessory) {
      this.log.debug("Received cached accessory:", accessory)
      this.cachedAccessories.push(accessory)
    }
  }

  homebridge.registerPlatform(PluginName, PlatformName, VivintPlatform)
};
