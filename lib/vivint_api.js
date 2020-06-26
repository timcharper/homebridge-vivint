const request = require("request-promise-native")
isObject = require("isobject")
const PubNub = require('pubnub')
const extend = require('util')._extend
const VivintDict = require("./vivint_dictionary.json")

const fetchWithRetry = (url) => {
  const fetchDataWithRetry = () => {
    return request(url)
      .then(result => {
        return Promise.resolve(result)
      })
      .catch(err => {
        return new Promise((resolve,reject) => {
          setTimeout(() => {
            return resolve(fetchDataWithRetry())
          }, 5000)
        })
      })
  }
  return fetchDataWithRetry()
}

function getKeyByValueDeep(object, value) {
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
          var mappedProperty = getKeyByValueDeep(dict.Fields, property)
          
          mappedProperty = mappedProperty || getKeyByValueDeep(dict, property) || property

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

function VivintApiModule(config, log) {
  class VivintApi {
    constructor(creds, panelId, cookie, sessionInfo, systemInfo) {
      this.creds = creds
      this.panelId = panelId
      this.parId = systemInfo.System.Partitions[0].PartitionId
      this.cookie = cookie
      this.sessionInfo = sessionInfo
      this.systemInfo = systemInfo
    }

    deviceSnapshot() {
      return this.systemInfo.System.Partitions[0]
    }

    deviceSnapshotTs() {
      return this.systemInfo.System.PanelContext.Timestamp
    }

    renew() {
      let self = this
      return VivintApi.doAuth(this.creds).then(
        (result) => {
          log("Renewed Vivint API session. ", self.cookie, result.cookie)
          self.cookie = result.cookie
          self.sessionInfo = result.sessionInfo
          return this
        },
        (error) => {
          console.log("error renewing login", error)
          setTimeout(() => { this.renew() }, 5000)
        }
      )
    }

    renewSystemInfo() {
      return VivintApi.getSystemInfo(this.cookie, this.panelId).then((sysInfo) => {
        this.systemInfo = sysInfo
        return this
      })
    }

    connectPubNub() {
      let channel = "PlatformChannel#" + this.sessionInfo.Users.MessageBroadcastChannel
      let pubnub = new PubNub({
        subscribeKey : "sub-c-6fb03d68-6a78-11e2-ae8f-12313f022c90"
      })
      pubnub.subscribe({
        channels: [channel]
      })
      return pubnub;
    }

    parsePubNub(message) {
      return mapObject(message, VivintDict)
    }

    /**
     * Resource URL to some thing. uri should start with '/'
     */
    getPanelUrl(uri) {
      return "https://vivintsky.com/api/" + this.panelId + "/" + this.parId + uri
    }

    putDevice(category, id, data) {
      //In case of Alarm panel there is no id because it is treated on the Panel level
      let uriString = id != null ?
        "/" + category + "/" + id :
        "/" + category

      //Not sure if this is required at all
      if (id == null) {
        data.systemId = this.panelId
        data.partitionId = this.parId
      }

      return request({
        url: this.getPanelUrl(uriString),
        method: "PUT",
        body: JSON.stringify(data),
        headers: { Cookie: this.cookie }
      })
    }
  }

  VivintApi.doAuth = (creds, persistent = 0) => {
    let loginRequest = null

    if (persistent === 1) {
      loginRequest = fetchWithRetry({
        method: "POST",
        url: "https://vivintsky.com/api/login",
        body: JSON.stringify(creds),
        resolveWithFullResponse: true
      })
    } else {
      loginRequest = request({
        method: "POST",
        url: "https://vivintsky.com/api/login",
        body: JSON.stringify(creds),
        resolveWithFullResponse: true
      })
    }

    return loginRequest.then((r) => {
      let sessionInfo = mapObject(JSON.parse(r.body), VivintDict)
      let cookie = r.headers["set-cookie"][0].split(";")[0]
      return {sessionInfo: sessionInfo, cookie: cookie}
    })
  }

  VivintApi.getSystemInfo = (cookie, panelId) =>
    request({
      "url": "https://vivintsky.com/api/systems/" + panelId,
      "headers": {
        "Cookie": cookie,
        "Cache-Control": "no-store"
      }
    }).then((sysInfo) => { 
      return mapObject(JSON.parse(sysInfo), VivintDict) 
    })


  VivintApi.login = (creds, persistent = 0) => {
    return VivintApi.doAuth(creds, persistent).then((result) => {
      let sessionInfo = result.sessionInfo
      let cookie = result.cookie
      let panelId = sessionInfo.Users.System[0].PanelId

      return VivintApi.getSystemInfo(cookie, panelId).then((sysInfo) => {
        return new VivintApi(creds, panelId, cookie, sessionInfo, sysInfo)
      })
    })
  }

  return VivintApi;
}

module.exports = VivintApiModule
