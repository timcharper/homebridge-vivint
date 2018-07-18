const inherits = require('util').inherits;

function ThermostatCharacteristicsModule(homebridge) {
  // Borrowed from Homebridge-nest https://github.com/chrisjshull/homebridge-nest/blob/0c6b7deef340fb6041a34afc95ebe550504917e4/index.js#L33
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;

  // Define custom characteristics

  /*
   * Characteristic "Away"
   */
  Away = function () {
    Characteristic.call(this, 'Away', 'D6D47D29-4638-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(Away, Characteristic);
  Away.UUID = 'D6D47D29-4638-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "EcoMode"
   */
  EcoMode = function () {
    Characteristic.call(this, 'Eco Mode', 'D6D47D29-4639-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(EcoMode, Characteristic);
  EcoMode.UUID = 'D6D47D29-4639-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "FanTimerActive"
   */
  FanTimerActive = function () {
    Characteristic.call(this, 'Fan Timer Active', 'D6D47D29-4640-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(FanTimerActive, Characteristic);
  FanTimerActive.UUID = 'D6D47D29-4640-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "FanTimerDuration"
   */
  FanTimerDuration = function () {
    Characteristic.call(this, 'Fan Timer Duraton', 'D6D47D29-4641-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.UINT8,
      unit: Characteristic.Units.MINUTES,
      maxValue: 60,
      minValue: 15,
      minStep: 15,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(FanTimerDuration, Characteristic);
  FanTimerDuration.UUID = 'D6D47D29-4641-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "HasLeaf"
   */
  HasLeaf = function () {
    Characteristic.call(this, 'Has Leaf', 'D6D47D29-4642-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(HasLeaf, Characteristic);
  HasLeaf.UUID = 'D6D47D29-4642-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "ManualTestActive"
   */
  ManualTestActive = function () {
    Characteristic.call(this, 'Manual Test Active', 'D6D47D29-4643-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(ManualTestActive, Characteristic);
  ManualTestActive.UUID = 'D6D47D29-4643-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "SunlightCorrectionEnabled"
   */
  SunlightCorrectionEnabled = function () {
    Characteristic.call(this, 'Sunlight Correction Enabled', 'D6D47D29-4644-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(SunlightCorrectionEnabled, Characteristic);
  SunlightCorrectionEnabled.UUID = 'D6D47D29-4644-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "SunlightCorrectionActive"
   */
  SunlightCorrectionActive = function () {
    Characteristic.call(this, 'Sunlight Correction Active', 'D6D47D29-4645-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(SunlightCorrectionActive, Characteristic);
  SunlightCorrectionActive.UUID = 'D6D47D29-4645-4F44-B53C-D84015DAEBDB'

  /*
   * Characteristic "UsingEmergencyHeat"
   */
  UsingEmergencyHeat = function () {
    Characteristic.call(this, 'Using Emergency Heat', 'D6D47D29-4646-4F44-B53C-D84015DAEBDB');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(UsingEmergencyHeat, Characteristic);
  UsingEmergencyHeat.UUID = 'D6D47D29-4646-4F44-B53C-D84015DAEBDB'

  return {
    Away: Away,
    EcoMode: EcoMode,
    FanTimerActive: FanTimerActive,
    FanTimerDuration: FanTimerDuration,
    HasLeaf: HasLeaf,
    ManualTestActive: ManualTestActive,
    SunlightCorrectionEnabled: SunlightCorrectionEnabled,
    SunlightCorrectionActive: SunlightCorrectionActive,
    UsingEmergencyHeat: UsingEmergencyHeat
  };
}

module.exports = ThermostatCharacteristicsModule
