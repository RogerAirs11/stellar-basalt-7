import React from "react";
export function HeritageLightingOverlay({portal=false}:{portal?:boolean}){
  return <div className={`heritage-v2-lighting-overlay${portal?" heritage-v2-lighting-overlay--portal":""}`} aria-hidden="true"/>;
}
