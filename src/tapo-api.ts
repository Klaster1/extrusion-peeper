import { randomUUID } from "crypto";
import { loginDevice as _loginDevice } from "tp-link-tapo-connect";
import { checkError } from "tp-link-tapo-connect/dist/tapo-utils.js";
import { createRequire } from "module";

const baseUrl = "https://eu-wap.tplinkcloud.com/";

export type TapoDeviceType =
  | "SMART.TAPOBULB"
  | "SMART.TAPOPLUG"
  | "SMART.IPCAMERA"
  | "SMART.TAPOROBOVAC"
  | "SMART.TAPOHUB"
  | "SMART.TAPOSENSOR";

export interface TapoCloudLoginResponse {
  result: {
    token: string;
  };
}

// Base interface for common properties
export interface BaseTapoDevice {
  // Base interface doesn't include status since it varies by type
}

// Cloud device (from device list API)
export interface TapoCloudDevice extends BaseTapoDevice {
  deviceType: TapoDeviceType;
  accountApiUrl: string;
  role: number;
  fwVer: string;
  appServerUrl: string;
  deviceRegion: string;
  deviceId: string;
  deviceName: string;
  deviceHwVer: string;
  alias: string;
  deviceMac: string;
  oemId: string;
  deviceModel: string;
  hwId: string;
  fwId: string;
  isSameRegion: boolean;
  appServerUrlV2: string;
  status: number;
}

// Sensor device (from child device list)
export interface TapoSensorDevice extends BaseTapoDevice {
  parent_device_id: string;
  hw_ver: string;
  fw_ver: string;
  device_id: string;
  mac: string;
  type: "SMART.TAPOSENSOR";
  model: TapoSensorModel;
  hw_id: string;
  oem_id: string;
  specs: string;
  category: TapoDeviceCategory;
  bind_count: number;
  status_follow_edge: boolean;
  status: "online" | "offline";
  lastOnboardingTimestamp: number;
  rssi: number;
  signal_level: number;
  jamming_rssi: number;
  jamming_signal_level: number;
  at_low_battery: boolean;
  nickname: string;
  avatar: string;
  report_interval: number;
  region: string;

  // Temperature sensor specific fields (optional for other sensors)
  temp_unit?: "celsius" | "fahrenheit";
  current_temp?: number;
  current_humidity?: number;
  current_temp_exception?: number;
  current_humidity_exception?: number;
  battery_percentage?: number;

  // Motion sensor specific fields
  detected?: boolean;
}

// Union type for all device types
export type TapoDevice = TapoCloudDevice | TapoSensorDevice;

export interface TapoBulbDevice extends TapoCloudDevice {
  deviceType: "SMART.TAPOBULB";
  deviceName: "L520" | "L530";
  deviceModel: TapoBulbModel;
}

export interface TapoPlugDevice extends TapoCloudDevice {
  deviceType: "SMART.TAPOPLUG";
  deviceName: "P110";
  deviceModel: TapoPlugModel;
}

export interface TapoCameraDevice extends TapoCloudDevice {
  deviceType: "SMART.IPCAMERA";
  deviceName: "C110 2.0";
  deviceModel: TapoCameraModel;
}

export interface TapoRobovacDevice extends TapoCloudDevice {
  deviceType: "SMART.TAPOROBOVAC";
  deviceName: "RV30 Plus";
  deviceModel: TapoRobovacModel;
}

export interface TapoHubDevice extends TapoCloudDevice {
  deviceType: "SMART.TAPOHUB";
  deviceName: "H100";
  deviceModel: TapoHubModel;
}

export type TapoSpecificDevice =
  | TapoBulbDevice
  | TapoPlugDevice
  | TapoCameraDevice
  | TapoRobovacDevice
  | TapoHubDevice;

export interface TapoChildDeviceListResponse {
  child_device_list: TapoSensorDevice[];
  start_index: number;
  sum: number;
}

export interface TapoDeviceListResponse {
  result: {
    deviceList: TapoCloudDevice[];
  };
}

export type TapoDeviceCategory =
  | "subg.trigger.temp-hmdt-sensor"
  | "subg.trigger.motion-sensor"
  | "subg.trigger.button";

export type TapoDeviceStatus = "online" | "offline";

export type TapoSensorModel = "T315" | "T310" | "T100" | "S200B";

export type TapoBulbModel = "L520E(EU)" | "L530E(EU)";

export type TapoPlugModel = "P110(UK)";

export type TapoCameraModel = "C110";

export type TapoRobovacModel = "RV30 Plus(EU)";

export type TapoHubModel = "H100(UK)";

export type TapoTempUnit = "celsius" | "fahrenheit";

export interface TapoErrorResponse {
  error_code: number;
  msg: string;
}

export const getTapoCloudToken = async (
  email: string,
  password: string
): Promise<string> => {
  const loginRequest = {
    method: "login",
    params: {
      appType: "Tapo_Android",
      cloudPassword: password,
      cloudUserName: email,
      terminalUUID: randomUUID(),
    },
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(loginRequest),
  });

  const data: TapoCloudLoginResponse = await response.json();
  checkError(data);

  return data.result.token;
};

export const listDevices = async (
  token: string
): Promise<TapoCloudDevice[]> => {
  const getDeviceRequest = {
    method: "getDeviceList",
  };

  const url = new URL(baseUrl);
  url.searchParams.append("token", token);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(getDeviceRequest),
  });

  const data: TapoDeviceListResponse = await response.json();
  checkError(data);

  return data.result.deviceList;
};

export type ExtendedTapoDevice = ReturnType<typeof _loginDevice> & {
  getChildDeviceList: () => Promise<TapoChildDeviceListResponse>;
};

type TapoDeviceSendFunction<Result> = (request: {
  method: string;
  params?: any;
}) => Promise<Result>;

type SendFunction<T> = (send: TapoDeviceSendFunction<T>) => Promise<T>;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export const loginDevice = _loginDevice as unknown as (
  ...args: Parameters<typeof _loginDevice>
) => Promise<
  UnwrapPromise<ReturnType<typeof _loginDevice>> & {
    getChildDeviceList: () => Promise<TapoChildDeviceListResponse>;
  }
>;

const extendTapoDevice = <T>(methods: Record<string, SendFunction<T>>) => {
  const require = createRequire(import.meta.url);
  const tapoDeviceModule = require("tp-link-tapo-connect/dist/tapo-device.js");
  const fn = tapoDeviceModule.TapoDevice;
  // @ts-ignore - We're intentionally modifying the module
  tapoDeviceModule.TapoDevice = (...args: any[]) => {
    const send = args[0].send;
    const methodsWithSend = Object.fromEntries(
      Object.entries(methods).map(([key, value]) => [
        key,
        value.bind(null, send),
      ])
    );
    // @ts-ignore - Complex spread operation with any types
    return { ...fn(...args), ...methodsWithSend };
  };
};

extendTapoDevice({
  getChildDeviceList(
    send: TapoDeviceSendFunction<TapoChildDeviceListResponse>
  ): Promise<TapoChildDeviceListResponse> {
    return send({
      method: "get_child_device_list",
    });
  },
});
