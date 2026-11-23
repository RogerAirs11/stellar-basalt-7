import React,{useState} from "react";
import { copyTextToClipboard } from "./clipboard";

export function MarkdownView({text}:{text:string}){
 const normalized=text.replace(/\r\n?/g,"\n");
 return <div className="hdb-ai-markdown">{renderBlocks(normalized)}</div>;
}

type Cell={text:string;align:"left"|"center"|"right"|null};

function renderBlocks(source:string):React.ReactNode[]{
 const lines=source.split("\n"),out:React.ReactNode[]=[];let i=0,key=0;
 const push=(node:React.ReactNode)=>out.push(<React.Fragment key={`md-${key++}`}>{node}</React.Fragment>);
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue}
  const fence=line.match(/^\s*```\s*([^\s`]*)?.*$/);
  if(fence){const language=fence[1]||"";const body:string[]=[];i++;while(i<lines.length&&!/^\s*```\s*$/.test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;push(<CodeBlock code={body.join("\n")} language={language}/>);continue}
  const heading=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
  if(heading){const level=heading[1].length;push(React.createElement(`h${level}`,{},renderInline(heading[2],`h-${key}`)));i++;continue}
  if(/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(line)){push(<hr/>);i++;continue}
  if(/^\s*>/.test(line)){const quote:string[]=[];while(i<lines.length&&(/^\s*>/.test(lines[i])||!lines[i].trim())){quote.push(lines[i].replace(/^\s*>\s?/,""));i++}push(<blockquote>{renderBlocks(quote.join("\n"))}</blockquote>);continue}
  if(isTableHeader(lines,i)){
   const headers=splitTableRow(lines[i]);const aligns=splitTableRow(lines[i+1]).map(parseAlignment);const rows:string[][]=[];i+=2;
   while(i<lines.length&&lines[i].includes("|")&&lines[i].trim()){rows.push(splitTableRow(lines[i]));i++}
   push(<div className="hdb-ai-table-wrap"><table><thead><tr>{headers.map((cell,j)=><th key={j} style={alignStyle(aligns[j])}>{renderInline(cell,`th-${j}`)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{headers.map((_,c)=><td key={c} style={alignStyle(aligns[c])}>{renderInline(row[c]??"",`td-${r}-${c}`)}</td>)}</tr>)}</tbody></table></div>);continue
  }
  const listMatch=line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
  if(listMatch){const ordered=/^\d/.test(listMatch[1]),items:string[]=[];while(i<lines.length){const m=lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);if(!m||/^\d/.test(m[1])!==ordered)break;items.push(m[2]);i++;while(i<lines.length&&/^\s{2,}\S/.test(lines[i])&&!/^\s*([-+*]|\d+[.)])\s+/.test(lines[i]))items[items.length-1]+=`\n${lines[i++].trim()}`}
   const ListTag=ordered?"ol":"ul";push(<ListTag>{items.map((item,j)=><li key={j}>{renderListItem(item,`li-${j}`)}</li>)}</ListTag>);continue
  }
  const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!startsBlock(lines,i)){paragraph.push(lines[i++])}
  push(<p>{renderInlineWithBreaks(paragraph.join("\n"),`p-${key}`)}</p>);
 }
 return out;
}

function startsBlock(lines:string[],i:number){const s=lines[i];return /^\s*```/.test(s)||/^\s*#{1,6}\s+/.test(s)||/^\s*>/.test(s)||/^\s*([-+*]|\d+[.)])\s+/.test(s)||/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(s)||isTableHeader(lines,i)}
function isTableHeader(lines:string[],i:number){return i+1<lines.length&&lines[i].includes("|")&&/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])}
function splitTableRow(line:string){let s=line.trim();if(s.startsWith("|"))s=s.slice(1);if(s.endsWith("|"))s=s.slice(0,-1);return s.split(/(?<!\\)\|/).map(v=>v.replace(/\\\|/g,"|").trim())}
function parseAlignment(cell:string):Cell["align"]{const s=cell.trim();return s.startsWith(":")&&s.endsWith(":")?"center":s.endsWith(":")?"right":s.startsWith(":")?"left":null}
function alignStyle(align:Cell["align"]):React.CSSProperties|undefined{return align?{textAlign:align}:undefined}
function renderListItem(text:string,key:string){const task=text.match(/^\[([ xX])\]\s+(.+)$/);return task?<><input type="checkbox" checked={task[1].toLowerCase()==="x"} readOnly tabIndex={-1}/>{renderInlineWithBreaks(task[2],key)}</>:renderInlineWithBreaks(text,key)}
function renderInlineWithBreaks(text:string,key:string){const parts=text.split("\n"),out:React.ReactNode[]=[];for(let i=0;i<parts.length;i++){out.push(...renderInline(parts[i],`${key}-${i}`));if(i<parts.length-1)out.push(<br key={`${key}-br-${i}`}/>)}return out}

function renderInline(text:string,keyPrefix:string):React.ReactNode[]{
 const token=/(!?\[[^\]]*\]\([^\n)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s<]+)/g;
 const out:React.ReactNode[]=[];let cursor=0,n=0,match:RegExpExecArray|null;
 while((match=token.exec(text))){if(match.index>cursor)out.push(text.slice(cursor,match.index));const raw=match[0],key=`${keyPrefix}-${n++}`;out.push(renderInlineToken(raw,key));cursor=match.index+raw.length}
 if(cursor<text.length)out.push(text.slice(cursor));return out;
}
function renderInlineToken(raw:string,key:string):React.ReactNode{
 if(raw.startsWith("![")){const m=raw.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)$/);const url=m&&safeUrl(m[2]);return url?<MarkdownImage key={key} url={url} alt={m?.[1]??""} title={m?.[3]}/>:raw}
 if(raw.startsWith("[")){const m=raw.match(/^\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)$/);const url=m&&safeUrl(m[2]);return url?<a key={key} href={url} title={m?.[3]} target={isExternal(url)?"_blank":undefined} rel={isExternal(url)?"noreferrer noopener":undefined}>{renderInline(m?.[1]??"",`${key}-a`)}</a>:raw}
 if(raw.startsWith("`"))return <code key={key}>{raw.slice(1,-1)}</code>;
 if(raw.startsWith("**")||raw.startsWith("__"))return <strong key={key}>{renderInline(raw.slice(2,-2),`${key}-b`)}</strong>;
 if(raw.startsWith("~~"))return <del key={key}>{renderInline(raw.slice(2,-2),`${key}-d`)}</del>;
 if(raw.startsWith("*")||raw.startsWith("_"))return <em key={key}>{renderInline(raw.slice(1,-1),`${key}-e`)}</em>;
 const candidate=raw.startsWith("<")?raw.slice(1,-1):raw;const url=safeUrl(candidate);return url?<a key={key} href={url} target="_blank" rel="noreferrer noopener">{candidate}</a>:raw;
}
function safeUrl(value:string):string|null{try{if(value.startsWith("/"))return value;const u=new URL(value,location.origin);return ["http:","https:","mailto:"].includes(u.protocol)?value:null}catch{return null}}
function isExternal(value:string){try{return new URL(value,location.origin).origin!==location.origin}catch{return false}}

function MarkdownImage({url,alt,title}:{url:string;alt:string;title?:string}){
 const external=isExternal(url);
 const[allowed,setAllowed]=useState(!external);
 if(!allowed){let host=url;try{host=new URL(url,location.origin).hostname}catch{}return <span className="hdb-ai-md-image-gate"><span><strong>{alt||"External image"}</strong><small>{host}</small></span><button type="button" onClick={()=>setAllowed(true)}>Load image</button></span>}
 return <img className="hdb-ai-md-image" src={url} alt={alt} title={title} loading="lazy" referrerPolicy="no-referrer"/>;
}

function CodeBlock({code,language}:{code:string;language:string}){const[copied,setCopied]=useState(false);async function copy(){try{await copyTextToClipboard(code);setCopied(true);setTimeout(()=>setCopied(false),1200)}catch{}}return <div className="hdb-ai-code"><div className="hdb-ai-code-head"><span>{language||"code"}</span><button type="button" onClick={()=>void copy()}>{copied?"Copied":"Copy"}</button></div><pre><code className={language?`language-${language}`:undefined}>{code}</code></pre></div>}
