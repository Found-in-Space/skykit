import type { SkykitActionId, SkykitPlugin, Vector3Like } from './index.d.ts';

export interface ParallaxOffsetControlValue {
  x: number;
  y: number;
  source: string | null;
  active: boolean;
}

export interface ParallaxPointerInputOptions {
  enabled?: boolean;
  mode?: 'hover' | 'drag' | 'both';
  target?: EventTarget & {
    getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
    clientWidth?: number;
    clientHeight?: number;
  };
  resetOnLeave?: boolean;
  resetOnRelease?: boolean;
  invertX?: boolean;
  invertY?: boolean;
  preventDefault?: boolean;
}

export interface DeviceTiltUpdate extends ParallaxOffsetControlValue {
  enabled: boolean;
  calibrated: boolean;
  eventCount: number;
  updateCount: number;
}

export interface DeviceTiltPermissionResult {
  ok: boolean;
  reason?: string;
}

export interface DeviceTiltTrackerOptions {
  id?: string;
  enabled?: boolean;
  eventTarget?: EventTarget | null;
  deviceOrientationEvent?: unknown;
  screenSource?: unknown;
  requestPermission?: () => Promise<unknown> | unknown;
  responseDeg?: number;
  xResponseDeg?: number;
  yResponseDeg?: number;
  deadzone?: number;
  invertX?: boolean;
  invertY?: boolean;
  onUpdate?: (update: DeviceTiltUpdate) => void;
}

export interface DeviceTiltTrackerSnapshot {
  id: string;
  supported: boolean;
  enabled: boolean;
  disposed: boolean;
  calibrated: boolean;
  eventCount: number;
  updateCount: number;
  value: ParallaxOffsetControlValue;
}

export interface DeviceTiltTracker {
  readonly id: string;
  enable(): Promise<DeviceTiltPermissionResult>;
  disable(): void;
  recenter(): void;
  handleDeviceOrientation(event: { beta?: number | null; gamma?: number | null }): void;
  getSnapshot(): DeviceTiltTrackerSnapshot;
  dispose(): void;
}

export interface ParallaxOffsetInputPluginOptions {
  id?: string;
  target?: ParallaxPointerInputOptions['target'];
  controlId?: SkykitActionId;
  pointer?: boolean | ParallaxPointerInputOptions;
  tilt?: boolean | (DeviceTiltTrackerOptions & {
    enabled?: boolean;
    autoEnable?: boolean;
  });
}

export interface ParallaxObserverPluginOptions {
  id?: string;
  priority?: number;
  enabled?: boolean;
  controlId?: SkykitActionId;
  anchorObserverPc?: Vector3Like;
  targetPc?: Vector3Like;
  targetDistancePc?: number;
  upIcrs?: Vector3Like;
  offsetPc?: number;
  smoothing?: number;
  lockTarget?: boolean;
}

export declare function createParallaxOffsetInputPlugin(options?: ParallaxOffsetInputPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};

export declare function createParallaxObserverPlugin(options?: ParallaxObserverPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};

export declare function createDeviceTiltTracker(options?: DeviceTiltTrackerOptions): DeviceTiltTracker;
