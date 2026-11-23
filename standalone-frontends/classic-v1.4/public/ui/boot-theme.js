(()=>{
  try{
    const root=document.documentElement;
    const palettes=new Set(["registry","cobalt","forest","slate","indigo","plum"]);
    const fonts=new Set(["registry","sahel","kufi","nastaliq","classic"]);
    const palette=localStorage.getItem("registry.palette")||"registry";
    const preference=localStorage.getItem("registry.appearance")||"light";
    const resolved=preference==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):(preference==="dark"?"dark":"light");
    const density=localStorage.getItem("registry.density")||"compact";
    const savedFont=localStorage.getItem("registry.fontPack");
    const font=!savedFont||savedFont==="registry"?"classic":savedFont;
    root.dataset.palette=palettes.has(palette)?palette:"registry";
    root.dataset.appearance=resolved;
    root.dataset.appearancePreference=["light","dark","system"].includes(preference)?preference:"light";
    root.dataset.density=density==="comfortable"?"comfortable":"compact";
    root.dataset.fontPack=fonts.has(font)?font:"classic";
    root.style.colorScheme=resolved;
  }catch{}
})();
