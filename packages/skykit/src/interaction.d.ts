import type * as THREE from 'three';
import type { InteractionInputAdapter, ThreeHostPose, ThreeUIEnvironment, ThreePanelHostFrame } from '@found-in-space/touch-os/hosts/three';
import type { SkykitPlugin, SkykitThreeFrame } from './index.js';
export interface SkykitInteractionInputOptions {
  renderer: THREE.WebGLRenderer;
  origin: THREE.Object3D;
  include?: (source: XRInputSource) => boolean;
  now?: () => number;
}
export interface SkykitInteractionInput extends InteractionInputAdapter {
  getGripPose(handedness: 'left' | 'right'): ThreeHostPose | undefined;
}
export interface SkykitInteractionPluginOptions {
  id?: string;
  environment: ThreeUIEnvironment;
  now?: () => number;
  frame?: (frame: SkykitThreeFrame) => Partial<ThreePanelHostFrame>;
}
export function createSkykitInteractionInput(options: SkykitInteractionInputOptions): SkykitInteractionInput;
export function createSkykitInteractionPlugin(options: SkykitInteractionPluginOptions): SkykitPlugin;
