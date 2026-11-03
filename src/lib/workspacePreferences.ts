import {PublicKey} from '@solana/web3.js'
export const WORKSPACE_PREFERENCES_KEY='outsol-workspace-preferences-v1'
export interface WorkspacePalette {background:string;surface:string;elevated:string;border:string;text:string;secondary:string;accent:string}
export interface WorkspacePreferences {version:1;profileName:string;defaultFunder?:string;palette:WorkspacePalette;hotkeys:{enabled:boolean;buy:string;sell:string;review:string}}
export const WORKSPACE_PALETTES:Record<string,WorkspacePalette>={
 Graphite:{background:'#111315',surface:'#191D20',elevated:'#20262A',border:'#2D3539',text:'#EDF2EF',secondary:'#ADB8B3',accent:'#C5D7E3'},
 Midnight:{background:'#10141D',surface:'#181E2A',elevated:'#222B3A',border:'#354054',text:'#EEF2F8',secondary:'#B4C0D2',accent:'#B7C9F5'},
 Slate:{background:'#171819',surface:'#222426',elevated:'#2A2D30',border:'#42474B',text:'#F0F1EF',secondary:'#BDC2C1',accent:'#D5D8C8'},
}
export const DEFAULT_WORKSPACE_PREFERENCES:WorkspacePreferences={version:1,profileName:'',palette:WORKSPACE_PALETTES.Graphite,hotkeys:{enabled:false,buy:'b',sell:'s',review:'r'}}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export function colorContrast(a:string,b:string):number{
 const luminance=(hex:string)=>{const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722}
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
export function validateWorkspacePreferences(input:unknown):WorkspacePreferences{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('The workspace settings are invalid.')
 const value=input as WorkspacePreferences
 if(value.version!==1||typeof value.profileName!=='string'||value.profileName.length>50||/[\u0000-\u001f\u007f]/.test(value.profileName)||!value.palette||!value.hotkeys)throw new Error('The workspace settings are invalid.')
 const palette=Object.fromEntries(Object.keys(WORKSPACE_PALETTES.Graphite).map(key=>{const color=value.palette[key as keyof WorkspacePalette];if(typeof color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(color))throw new Error('Use six-digit hexadecimal colors.');return [key,color]})) as unknown as WorkspacePalette
 if(colorContrast(palette.text,palette.background)<4.5||colorContrast(palette.text,palette.surface)<4.5||colorContrast(palette.secondary,palette.surface)<4.5||colorContrast(palette.accent,palette.surface)<4.5||colorContrast(palette.accent,'#111315')<4.5)throw new Error('Increase palette contrast: text, secondary labels and actions need at least 4.5:1 contrast.')
 const hotkeys=value.hotkeys
 if(typeof hotkeys.enabled!=='boolean'||[hotkeys.buy,hotkeys.sell,hotkeys.review].some(key=>typeof key!=='string'||!/^[a-z]$/.test(key))||new Set([hotkeys.buy,hotkeys.sell,hotkeys.review]).size!==3)throw new Error('Choose three distinct lowercase letters for review shortcuts.')
 let defaultFunder:string|undefined
 if(value.defaultFunder){const key=new PublicKey(value.defaultFunder);if(key.toBase58()!==value.defaultFunder||!PublicKey.isOnCurve(key.toBytes()))throw new Error('Choose a valid public funding wallet.');defaultFunder=value.defaultFunder}
 return {version:1,profileName:value.profileName.trim(),palette,hotkeys:{enabled:hotkeys.enabled,buy:hotkeys.buy,sell:hotkeys.sell,review:hotkeys.review},...(defaultFunder?{defaultFunder}:{})}
}
export function readWorkspacePreferences(storage:Storage=localStorage):WorkspacePreferences{
 try{const raw=storage.getItem(WORKSPACE_PREFERENCES_KEY);if(raw===null)return structuredClone(DEFAULT_WORKSPACE_PREFERENCES);if(raw.length>10000)throw new Error();return validateWorkspacePreferences(JSON.parse(raw))}catch{throw new Error('Workspace preferences cannot be read. Preserve browser data before replacing them.')}
}
export function saveWorkspacePreferences(input:WorkspacePreferences,storage:Storage=localStorage):WorkspacePreferences{
 readWorkspacePreferences(storage)
 const safe=validateWorkspacePreferences(input),raw=JSON.stringify(safe);storage.setItem(WORKSPACE_PREFERENCES_KEY,raw)
 if(storage.getItem(WORKSPACE_PREFERENCES_KEY)!==raw)throw new Error('Workspace settings could not be saved. Retry after checking browser storage.')
 if(typeof window!=='undefined')window.dispatchEvent(new Event('outsol-preferences-changed'))
 return safe
}
export function exportWorkspacePreferences(input:WorkspacePreferences):string{return JSON.stringify({type:'outsol-workspace-preferences',preferences:validateWorkspacePreferences(input)},null,2)}
export function importWorkspacePreferences(text:string,storage:Storage=localStorage):WorkspacePreferences{if(typeof text!=='string'||text.length>10000)throw new Error('Use a settings file smaller than 10 KB.');const value=JSON.parse(text);if(value?.type!=='outsol-workspace-preferences')throw new Error('Use an OutSol workspace settings export.');return saveWorkspacePreferences(validateWorkspacePreferences(value.preferences),storage)}
export function applyWorkspacePalette(palette:WorkspacePalette,style:Pick<CSSStyleDeclaration,'setProperty'>):void{
 const mapping:Record<string,string>={'--workspace-bg':palette.background,'--workspace-surface':palette.surface,'--workspace-elevated':palette.elevated,'--workspace-border':palette.border,'--workspace-text':palette.text,'--workspace-secondary':palette.secondary,'--workspace-muted':palette.secondary,'--mint':palette.accent,'--mint-dim':palette.accent,'--interaction':palette.accent}
 for(const [key,value] of Object.entries(mapping))style.setProperty(key,value)
}
