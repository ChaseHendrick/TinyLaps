const bindings={KeyW:'accelerate',ArrowUp:'accelerate',KeyS:'reverse',ArrowDown:'reverse',
  KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',ShiftLeft:'brake',ShiftRight:'brake'};

// Inputs belong to the active player, never to a saved race or a previous car.
export function setupDrivingInput({getSim,isPaused,isBlocked,onBlur}){
  const keys=new Set(),pointers=new Map(),buttonKeys=new Map();
  const buttons=[...document.querySelectorAll('[data-drive]')];
  const available=()=>getSim()?.playerCarId!=null&&!isPaused()&&!isBlocked();
  function update(){
    const actions=new Set([...keys].map(key=>bindings[key]).filter(Boolean));
    for(const {action} of pointers.values())actions.add(action);
    for(const action of buttonKeys.values())actions.add(action);
    const input=available()?{steer:Number(actions.has('right'))-Number(actions.has('left')),
      accelerate:Number(actions.has('accelerate')),reverse:Number(actions.has('reverse')),brake:Number(actions.has('brake'))}:{};
    getSim()?.setPlayerInput(input);
    for(const button of buttons){const pressed=available()&&actions.has(button.dataset.drive);button.classList.toggle('pressed',pressed);button.setAttribute('aria-pressed',String(pressed));}
  }
  function clear(){
    keys.clear();buttonKeys.clear();const held=[...pointers];pointers.clear();
    for(const [id,{button}] of held)if(button.hasPointerCapture?.(id))button.releasePointerCapture(id);
    update();
  }
  function keydown(event){
    if(getSim()?.playerCarId==null||isBlocked()||!bindings[event.code]||event.altKey||event.ctrlKey||event.metaKey
      ||event.target.closest?.('input,select,textarea,[contenteditable=true]'))return false;
    event.preventDefault();event.stopImmediatePropagation();
    if(available()&&(!event.repeat||keys.has(event.code))){keys.add(event.code);update();}
    return true;
  }
  addEventListener('keyup',event=>{if(keys.delete(event.code))update();if(event.code==='Space'||event.code==='Enter'){buttonKeys.clear();update();}});
  for(const button of buttons){
    button.addEventListener('pointerdown',event=>{
      if(!available()||event.button!==0)return;event.preventDefault();
      pointers.set(event.pointerId,{button,action:button.dataset.drive});try{button.setPointerCapture(event.pointerId);}catch{}update();
    });
    const release=event=>{if(pointers.delete(event.pointerId))update();};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('keydown',event=>{if(!['Space','Enter'].includes(event.code)||!available())return;event.preventDefault();buttonKeys.set(button,button.dataset.drive);update();});
    button.addEventListener('blur',()=>{if(buttonKeys.delete(button))update();});
    button.addEventListener('contextmenu',event=>event.preventDefault());
  }
  // Mouse and keyboard players steer with keys; the touch pedals appear once a touch is seen.
  addEventListener('pointerdown',event=>{if(event.pointerType==='touch')document.body.classList.add('touch-input');},{capture:true,passive:true});
  addEventListener('pointerup',event=>{if(pointers.delete(event.pointerId))update();});
  addEventListener('pointercancel',event=>{if(pointers.delete(event.pointerId))update();});
  addEventListener('blur',()=>{clear();onBlur();});
  document.addEventListener('focusin',event=>{if(event.target.closest?.('input,select,textarea,[contenteditable=true]'))clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();onBlur();}});
  return {clear,keydown};
}
