/** Minimal deterministic DOM for controller/renderer tests. Not browser or layout QA. */
export class TestElement extends EventTarget {
 tagName:string;children:TestElement[]=[];private ownText='';attributes=new Map<string,string>();properties=new Map<string,string>();className='';hidden=false;disabled=false;value='';id='';href='';type='';tabIndex=0;scope='';onclick:(()=>void)|null=null;focused=false;
 constructor(tag:string){super();this.tagName=tag.toUpperCase();}
 style=(()=>{const properties=this.properties;return {get length(){return properties.size;},item:(index:number)=>[...properties.keys()][index],setProperty:(key:string,value:string)=>properties.set(key,value),removeProperty:(key:string)=>properties.delete(key)};})();
 get textContent():string{return this.ownText+this.children.map(child=>child.textContent).join('');}
 set textContent(value:string){this.ownText=value;this.children=[];}
 append(...nodes:(TestElement|string)[]){for(const node of nodes){const child=typeof node==='string'?Object.assign(new TestElement('#text'),{textContent:node}):node;this.children.push(child);if(this.tagName==='SELECT'&&this.children.length===1)this.value=child.value;}}
 replaceChildren(...nodes:(TestElement|string)[]){this.ownText='';this.children=[];this.append(...nodes);}
 setAttribute(key:string,value:string){this.attributes.set(key,value);}
 getAttribute(key:string){return this.attributes.get(key)??null;}
 getAttributeNames(){return [...this.attributes.keys()];}
 removeAttribute(key:string){this.attributes.delete(key);}
 toggleAttribute(key:string,enabled:boolean){if(enabled)this.attributes.set(key,'');else this.attributes.delete(key);if(key==='disabled')this.disabled=enabled;}
 focus(){this.focused=true;}
 click(){if(this.disabled)return;this.dispatchEvent(new Event('click'));this.onclick?.();}
 walk():TestElement[]{return [this,...this.children.flatMap(child=>child.walk())];}
 get validity(){return {valid:true};}reportValidity(){return true;}
}
export function createTestDocument(){const elements=new Map<string,TestElement>();const document={title:'',createElement:(tag:string)=>new TestElement(tag),createTextNode:(text:string)=>Object.assign(new TestElement('#text'),{textContent:text}),getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new TestElement(id==='client-month'?'input':'div'));return elements.get(id)!;}};return {document,elements};}
export const flush=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
export function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
