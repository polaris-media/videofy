import { z } from "zod";
import { cameraMovementsEnum } from "@videofy/types";

export const calculateCameraMovement = (
  effect: number,
  cameraMovement?: z.infer<typeof cameraMovementsEnum>
) => {
  switch (cameraMovement) {
    case "zoom-in":
      return {
        scale: 1 + effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: 0,
      };
    case "zoom-out":
      return {
        scale: 1.2 - effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: 0,
      };
    case "pan-left":
      return {
        scale: 1.4,
        posX: -100 + 75 * effect,
        posY: 0,
        rotation: 0,
      };
    case "pan-right":
      return {
        scale: 1.4,
        posX: 100 - 75 * effect,
        posY: 0,
        rotation: 0,
      };
    case "pan-up":
      return {
        scale: 1.2,
        posX: 0,
        posY: 50 * effect,
        rotation: 0,
      };
    case "pan-down":
      return {
        scale: 1.2,
        posX: 0,
        posY: -50 * effect,
        rotation: 0,
      };
    case "zoom-rotate-right":
      return {
        scale: 1.2 + effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: 2 * effect,
      };
    case "zoom-rotate-left":
      return {
        scale: 1.2 + effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: -2 * effect,
      };
    case "zoom-out-rotate-right":
      return {
        scale: 1.4 - effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: 2 * effect,
      };
    case "zoom-out-rotate-left":
      return {
        scale: 1.4 - effect * 0.07,
        posX: 0,
        posY: 0,
        rotation: -2 * effect,
      };
    default:
      return {
        scale: 1,
        posX: 0,
        posY: 0,
        rotation: 0,
      };
  }
};
