var Accessory, Service, Characteristic, UUIDGen;

const PluginName = "homebridge-vivint"
const PlatformName = "Vivint"
const VivintApiModule = require("./lib/vivint_api.js")
const DeviceSetModule = require("./lib/device_set.js")
const ThermostatCharacteristicsModule = require("./lib/thermostat_characteristics.js")

function asyncAccumulator() {
  let accum = []
  var open = true

  let append = (e) => {
    if (open)
      accum.push(e)
    else
      throw "Accumulator is closed"
  }

  var promiseCompleter = null
  let finalize = () => {
    open = false
    promiseCompleter(accum)
  }

  let result = new Promise((success, reject) => {
    promiseCompleter = success
  })

  return {append, finalize, result}
}

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  let ThermostatCharacteristics = ThermostatCharacteristicsModule(homebridge)

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

      let VivintApi = VivintApiModule(config, log)
      this.vivintApiPromise = VivintApi.login({username: config.username, password: config.password}, 1)
      let apiLoginRefreshSecs = config.apiLoginRefreshSecs || 1200 // once per 20 minutes default

      this.deviceSetPromise = this.vivintApiPromise.then((vivintApi) => {
        let DeviceSet = DeviceSetModule(config, log, homebridge, vivintApi, ThermostatCharacteristics, setInterval, Date)
        let deviceSet = new DeviceSet()

        //Store panel login info
        setInterval(() => {
          vivintApi.renew()
            .then((vivintApi) => vivintApi.renewPanelLogin())
            .catch((err) => log("Error refreshing login info", err))
        }, apiLoginRefreshSecs * 1000)

        //Setting up the system info refresh to keep the notification stream active
        setInterval(() => {
            vivintApi.renewSystemInfo()
              .then((vivintApi) => deviceSet.handleSnapshot(vivintApi.deviceSnapshot(), vivintApi.deviceSnapshotTs()))
              .catch((err) => log("Error getting system info", err))
        }, (apiLoginRefreshSecs / 20) * 1000)

        return {deviceSet, DeviceSet}
      })

      let pubNubPromise = this.vivintApiPromise.then((vivintApi) => vivintApi.connectPubNub())

      this.cachedAccessories = asyncAccumulator()
      api.on('didFinishLaunching', () => this.cachedAccessories.finalize())

      Promise.all([pubNubPromise, this.vivintApiPromise, this.cachedAccessories.result, this.deviceSetPromise]).then(
        ([pubNub, vivintApi, cachedAccessories, {DeviceSet, deviceSet}]) => {
          
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

          log("Removing " + removedAccessories.length + " stale accessories")
          removedAccessories.forEach((acc) => log(acc.context))

          log("Adding " + newAccessories.length + " new accessories")
          newAccessories.forEach((acc) => log(acc.context))

          api.unregisterPlatformAccessories(PluginName, PlatformName, removedAccessories)
          api.registerPlatformAccessories(PluginName, PlatformName, newAccessories)

          cachedAccessories = cachedAccessories.filter((el) => !removedAccessories.includes(el));
          cachedAccessories.forEach((accessory) => deviceSet.bindAccessory(accessory))
          newAccessories.forEach((accessory) => deviceSet.bindAccessory(accessory))

          pubNub.addListener({
            status: function(statusEvent) {
              switch(statusEvent.category){
                case 'PNConnectedCategory':
                case 'PNReconnectedCategory':
                  log("Connected to Pubnub")
                  break
                default:
                  log("Could not connect to Pubnub, reconnecting...", statusEvent)
              }
            },
            message: function(msg) {
              //log("Parsed PubNub message")
              //log(JSON.stringify(vivintApi.parsePubNub(msg.message)))
              deviceSet.handleMessage(vivintApi.parsePubNub(msg.message))
            }
          })
          deviceSet.handleSnapshot(vivintApi.deviceSnapshot(), vivintApi.deviceSnapshotTs())
        }
      ).catch((error) => {
        log("Error while bootstrapping accessories")
        log(error)
        // Make it obvious that things are bad by causing everything to show as "no response"
        this.cachedAccessories.result.then(setCatastrophe)
      });
    }

    configureAccessory(accessory) {
      //console.log("received cached accessory", accessory)
      this.cachedAccessories.append(accessory)
    }
  }

  homebridge.registerPlatform(PluginName, PlatformName, VivintPlatform)
};
