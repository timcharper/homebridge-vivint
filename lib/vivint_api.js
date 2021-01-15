const request = require("request-promise-native")
const isObject = require("isobject")
const PubNub = require('pubnub')
const VivintDict = require("./vivint_dictionary.json")

const PUBNUB_KEY = 'sub-c-6fb03d68-6a78-11e2-ae8f-12313f022c90'
const VIVINT_URL = 'https://vivintsky.com/api'

function VivintApiModule(config, log) {
  class VivintApi {
    constructor(creds, panelId, cookie, sessionInfo, systemInfo, panelLogin) {
      this.creds = creds
      this.panelId = panelId
      this.parId = systemInfo.System.Partitions[0].PartitionId
      this.cookie = cookie
      this.sessionInfo = sessionInfo
      this.systemInfo = systemInfo
      this.panelLogin = panelLogin
    }

    deviceSnapshot() {
      return this.systemInfo.System.Partitions[0]
    }

    deviceSnapshotTs() {
      return this.systemInfo.System.PanelContext.Timestamp
    }

    renew() {
      let self = this
      return VivintApi.doAuth(this.creds)
      .then((result) => {
          log.debug("Renewed Vivint API session. ", self.cookie, result.cookie)

          self.cookie = result.cookie
          self.sessionInfo = result.sessionInfo
          return this
        },
        (error) => {
          log.error("Error renewing login", error)
          setTimeout(() => { this.renew() }, 5000)
        }
      )
    }

    async renewSystemInfo() {
      let sysInfo = await VivintApi.getSystemInfo(this.cookie, this.panelId)
      this.systemInfo = sysInfo
      return this
    }

    async renewPanelLogin() {
      let panelLogin = await VivintApi.getPanelLogin(this.cookie, this.panelId)
      this.panelLogin = panelLogin
      return this
    }

    async connectPubNub() {
      let channel = "PlatformChannel#" + this.sessionInfo.Users.MessageBroadcastChannel
      let pubnub = new PubNub({
        subscribeKey : PUBNUB_KEY
      })

      pubnub.subscribe({
        channels: [channel]
      })

      return pubnub
    }

    parsePubNub(message) {
      return mapObject(message, VivintDict)
    }

    async setLockState(lockId, newState) {
      return await this.putDevice('locks', lockId, { [VivintDict.Fields.Id]: lockId, [VivintDict.Fields.Status]: newState } )
    }

    async setPanelState(newState) {
      return await this.putDevice('armedstates', null, { armState: newState, forceArm: false } )
    }

    async setThermostatFanState(thermostatId, newState) {
      return await this.putDevice('thermostats', thermostatId, { fm: newState } )
    }

    async setThermostatState(thermostatId, newState) {
      return await this.putDevice('thermostats', thermostatId, { om: newState } )
    }

    async setThermostatHeatSetPoint(thermostatId, newTemperature) {
      return await this.putDevice('thermostats', thermostatId, { hsp: newTemperature } )
    }

    async setThermostatCoolSetPoint(thermostatId, newTemperature) {
      return await this.putDevice('thermostats', thermostatId, { csp: newTemperature } )
    }

    async putDevice(category, id, data) {
      //In case of Alarm panel there is no id because it is treated on the Panel level
      let uriString = id != null ?
        `${category}/${id}` :
        category

      // data.systemId = this.panelId
      // data.partitionId = this.parId
      
      return request({
        method: "PUT",
        url: `${VIVINT_URL}/${this.panelId}/${this.parId}/${uriString}`,
        body: JSON.stringify(data),
        headers: { Cookie: this.cookie }
      })
    }

    getDictionaryKeyByValue(dictionary, value) {
      return getKeyByValueDeep(dictionary, value)
    }
  }

  VivintApi.doAuth = async (creds) => {
    try {
      let requestResult = await request({
        method: "POST",
        url: `${VIVINT_URL}/login`,
        body: JSON.stringify(creds),
        resolveWithFullResponse: true
      })

      let sessionInfo = mapObject(JSON.parse(requestResult.body), VivintDict)
      let cookie = requestResult.headers["set-cookie"][0].split(";")[0]
  
      return {sessionInfo: sessionInfo, cookie: cookie}
    }
    catch (err) {
      if (err.response) {
        let errCode = err.response.status;
        let errData = err.response.data;
        log.error('Error occured during login, retrying...', errCode, errData)
      }
      else log.error('Error occured during login, retrying...', err)

      setTimeout(() => { VivintApi.doAuth(creds) }, 5000)
    }
  }

  VivintApi.getSystemInfo = async (cookie, panelId) => {
    let sysInfo = await request({
      "url": `${VIVINT_URL}/systems/${panelId}`,
      "headers": {
        "Cookie": cookie,
        "Cache-Control": "no-store"
      }
    })

    return mapObject(JSON.parse(sysInfo), VivintDict) 
  }

  VivintApi.getPanelLogin = async (cookie, panelId) => {
    let panelLogin = await request({
      "url": `${VIVINT_URL}/panel-login/${panelId}`,
      "headers": {
        "Cookie": cookie,
        "Cache-Control": "no-store"
      }
    })

    return mapObject(JSON.parse(panelLogin), VivintDict) 
  }

  VivintApi.login = async (creds, persistent = 0) => {
    let authResult = await VivintApi.doAuth(creds, persistent)

    let sessionInfo = authResult.sessionInfo
    let cookie = authResult.cookie
    let panelId = sessionInfo.Users.System[0].PanelId

    const [sysInfo, panelLogin] = await Promise.all([VivintApi.getSystemInfo(cookie, panelId), VivintApi.getPanelLogin(cookie, panelId)])

    return new VivintApi(creds, panelId, cookie, sessionInfo, sysInfo, panelLogin)
  }

  function getKeyByValueDeep(object, value){
    var key = Object.keys(object).find(key => object[key] === value)
  
    if (key === undefined){
      for (const property in object) {
        if (object.hasOwnProperty(property) && isObject(object[property])) {
            const propertyValue = object[property]
            var result = getKeyByValueDeep(propertyValue, value)
            if (result !== undefined) return (property !== "Fields" ? property + "_" : "" ) + result
        }
      }
    }
    else return key;
  }
  
  function mapObject(object, dict){
    var mappedObject = {}
    for (const property in object) {
        if (object.hasOwnProperty(property)) {
            const value = object[property]
            var mappedProperty = getKeyByValueDeep(dict.Fields, property) || getKeyByValueDeep(dict, property) || property
  
            if (!isObject(value) && !Array.isArray(value)){
              mappedObject[mappedProperty] = value
            }
            else if (Array.isArray(value)){
              mappedObject[mappedProperty] = value.map((item) => { return isObject(item) || Array.isArray(item) ? mapObject(item, dict) : item })
            }
            else {
              mappedObject[mappedProperty] = mapObject(value, dict)
            }
        }
    }
  
    return mappedObject;
  }

  return VivintApi;
}

module.exports = VivintApiModule
