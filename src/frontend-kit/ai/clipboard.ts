export async function copyTextToClipboard(text:string):Promise<void>{
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return}catch{}}
 const area=document.createElement("textarea");area.value=text;area.setAttribute("readonly","");area.style.position="fixed";area.style.inset="-9999px auto auto -9999px";area.style.opacity="0";document.body.appendChild(area);area.select();const ok=document.execCommand("copy");area.remove();if(!ok)throw new Error("Clipboard copy failed");
}

