import {useCallback, useEffect, useRef, useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../firebase';
import {isMemoryCryptoReady, onMemoryCryptoChanged} from '../services/memoryCrypto';

/** Prevent late completion messages from crossing a logout, vault change, closed panel or unmount. */
export function useSyncFeedback(active=true) {
  const generation = useRef(0); const alive = useRef(false); const visible = useRef(active); const [epoch,setEpoch] = useState(0);
  useEffect(()=>{if(visible.current!==active){generation.current++;setEpoch(generation.current);}visible.current=active;},[active]);
  useEffect(()=>{
    generation.current++;alive.current=true; let uid=auth.currentUser?.uid;
    const change=()=>{generation.current++;setEpoch(generation.current);};
    const stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid){uid=user?.uid;change();}});
    const stopVault=onMemoryCryptoChanged(change);
    return ()=>{alive.current=false;stopAuth();stopVault();};
  },[]);
  const captureAccount=useCallback((uid:string)=>{
    const observed=generation.current;
    return ()=>alive.current&&visible.current&&generation.current===observed&&auth.currentUser?.uid===uid;
  },[]);
  const capture=useCallback((uid:string)=>{const current=captureAccount(uid);return()=>current()&&isMemoryCryptoReady();},[captureAccount]);
  return {epoch,capture,captureAccount};
}
