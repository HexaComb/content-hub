import test from 'node:test';
import assert from 'node:assert/strict';
import {themePresentation} from '../src/scripts/theme.ts';
import {themePresets} from '../../src/themeSchema.ts';
test('presentation compiler emits a closed set of scoped variables and layout tokens',()=>{
 for(const theme of Object.values(themePresets)){
  const compiled=themePresentation(theme)!;assert.ok(compiled);
  assert.ok(Object.keys(compiled.variables).every(k=>k.startsWith('--project-')));
  assert.ok(Object.keys(compiled.attributes).every(k=>k.startsWith('data-project-')));
  assert.equal(compiled.attributes['data-project-theme'],'1');
 }
 assert.equal(themePresentation({...themePresets.night,css:'body{display:none}'}),null);
 assert.equal(themePresentation({...themePresets.night,brand:{...themePresets.night.brand,logo:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',alt:'Rejected logo'}}}),null);
 assert.equal(themePresentation({...themePresets.night,colors:{...themePresets.night.colors,text:'#101010'}}),null);
 assert.equal(themePresentation({...themePresets.night,layout:{...themePresets.night.layout,hero:'<script>'}}),null);
 const html='<img src=x onerror=alert(1)>';
 const compiled=themePresentation({...themePresets.night,brand:{...themePresets.night.brand,tagline:html}})!;
 assert.equal(compiled.theme.brand.tagline,html); // Rendered via textContent, never innerHTML.
 assert.ok(!Object.values(compiled.variables).includes(html));
});

test('applying and clearing a theme keeps DOM order aligned and removes only project styling',async()=>{
 const {applyProjectTheme,clearProjectTheme}=await import('../src/scripts/theme.ts');
 const heading={},metrics={},comparison={},details={};const eyebrow={textContent:'',hidden:true},tagline={textContent:'',hidden:true};
 const logo={src:'',alt:'',hidden:true,removeAttribute(name:string){if(name==='src')this.src='';}};
 const attributes=new Map([['aria-busy','true']]);const properties=new Map([['--unrelated','keep']]);const children:unknown[]=[heading,metrics,comparison,details];
 const selectors=new Map<string,unknown>([[':scope > .section-heading',heading],[':scope > .metrics',metrics],[':scope > .detail-grid, :scope > .comparison-panel',comparison],[':scope > .data-panel',details],['#theme-eyebrow',eyebrow],['#theme-tagline',tagline],['#theme-logo',logo]]);
 const root={querySelector:(selector:string)=>selectors.get(selector)??null,append(node:unknown){children.splice(children.indexOf(node),1);children.push(node);},getAttributeNames:()=>[...attributes.keys()],removeAttribute:(name:string)=>attributes.delete(name),setAttribute:(name:string,value:string)=>attributes.set(name,value),style:{get length(){return properties.size;},item:(index:number)=>[...properties.keys()][index],removeProperty:(name:string)=>properties.delete(name),setProperty:(name:string,value:string)=>properties.set(name,value)}} as unknown as HTMLElement;
 applyProjectTheme(root,{revision:1,theme:themePresets.editorial,updatedAt:null});
 assert.deepEqual(children,[comparison,heading,metrics,details]);assert.equal(tagline.textContent,themePresets.editorial.brand.tagline);assert.equal(attributes.get('data-project-order'),'comparison-first');
 clearProjectTheme(root);assert.deepEqual(children,[heading,metrics,comparison,details]);assert.deepEqual([...attributes],[['aria-busy','true']]);assert.deepEqual([...properties],[['--unrelated','keep']]);assert.equal(tagline.hidden,true);assert.equal(tagline.textContent,'');assert.equal(logo.src,'');
 applyProjectTheme(root,{revision:2,theme:null,updatedAt:null});assert.equal(attributes.has('data-project-theme'),false);
});
