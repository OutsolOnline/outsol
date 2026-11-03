'use client'
import {useEffect} from 'react'
import {applyWorkspacePalette,readWorkspacePreferences,WORKSPACE_PREFERENCES_KEY} from '@/lib/workspacePreferences'

export function WorkspacePreferencesProvider(){
 useEffect(()=>{
  const apply=()=>{try{applyWorkspacePalette(readWorkspacePreferences().palette,document.documentElement.style);document.documentElement.dataset.outsolTheme='custom'}catch{/* Unreadable preferences are preserved; the Settings screen provides recovery guidance. */}}
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key===WORKSPACE_PREFERENCES_KEY)apply()}
  const shortcut=(event:KeyboardEvent)=>{
   if(!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.repeat||event.defaultPrevented)return
   const target=event.target
   if(target instanceof HTMLElement&&(target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('[role="dialog"][data-state="open"]')))return
   try{const settings=readWorkspacePreferences().hotkeys;if(!settings.enabled)return;const action=(['buy','sell','review'] as const).find(key=>settings[key]===event.key.toLowerCase());if(action){event.preventDefault();window.dispatchEvent(new CustomEvent('outsol-trade-shortcut',{detail:{action}}))}}catch{/* No hotkey runs with unreadable settings. */}
  }
  apply();window.addEventListener('storage',storage);window.addEventListener('outsol-preferences-changed',apply);window.addEventListener('keydown',shortcut)
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener('outsol-preferences-changed',apply);window.removeEventListener('keydown',shortcut)}
 },[])
 return null
}
