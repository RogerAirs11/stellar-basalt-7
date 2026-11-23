import React from "react";
import type { FrontendRuntimeProps } from "../../../frontend-kit";
import { RetroAstraDonorTransplant } from "./transplant/App";
import "./transplant/donor-scoped.css";
import "./transplant/density-tokens.css";
import "./transplant/compact-r88.css";
import "./transplant/styles/desk-polish.css";
import "./transplant/styles/hierarchical-navigation.css";

/** Native routes, including profile entry forms, share Retro's locale and appearance workspace. */
export default function RetroAstraFrontend(runtime: FrontendRuntimeProps) {
  return <RetroAstraDonorTransplant runtime={runtime} />;
}
