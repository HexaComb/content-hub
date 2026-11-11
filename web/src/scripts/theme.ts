import { projectThemeSchema, type ProjectThemeState } from '../../../src/themeSchema.ts';
const headings = {sans:'Inter, ui-sans-serif, system-ui, sans-serif',editorial:'Georgia, "Times New Roman", serif',display:'Impact, Haettenschweiler, "Arial Black", sans-serif',mono:'"Courier New", ui-monospace, monospace'};
const bodies = {sans:'Inter, ui-sans-serif, system-ui, sans-serif',humanist:'"Trebuchet MS", Verdana, sans-serif'};
const corners = {square:'0px',soft:'10px',rounded:'22px'};
/** Compile to a closed set of properties; never accept CSS or arbitrary selectors. */
export function themePresentation(raw:unknown) {
 const parsed=projectThemeSchema.safeParse(raw);if(!parsed.success)return null;
 const theme=parsed.data;
 const variables:Record<string,string>={};
 for(const [key,color] of Object.entries(theme.colors))variables[`--project-${key}`]=color;
 variables['--project-heading']=headings[theme.typography.heading];variables['--project-body']=bodies[theme.typography.body];
 variables['--project-radius']=corners[theme.layout.corners];variables['--project-columns']=String(theme.layout.columns);
 variables['--project-gap']=theme.layout.density==='airy'?'24px':'14px';variables['--project-pad']=theme.layout.density==='airy'?'28px':'20px';
 const attributes:Record<string,string>={'data-project-theme':'1'};
 for(const [key,value] of Object.entries(theme.layout))attributes[`data-project-${key}`]=String(value);
 attributes['data-project-heading']=theme.typography.heading;
 return {theme,variables,attributes};
}
function arrangeSections(root:HTMLElement,comparisonFirst=false) {
 const heading=root.querySelector(':scope > .section-heading'),metrics=root.querySelector(':scope > .metrics'),comparison=root.querySelector(':scope > .detail-grid, :scope > .comparison-panel'),details=root.querySelector(':scope > .data-panel');
 // Keep keyboard and screen-reader order aligned with the visible page order.
 for(const section of comparisonFirst?[comparison,heading,metrics,details]:[heading,metrics,comparison,details])if(section)root.append(section);
}
export function clearProjectTheme(root:HTMLElement|null) {
 if(!root)return;
 arrangeSections(root);
 for(const name of root.getAttributeNames())if(name.startsWith('data-project-'))root.removeAttribute(name);
 for(let i=root.style.length-1;i>=0;i--){const name=root.style.item(i);if(name.startsWith('--project-'))root.style.removeProperty(name);}
 for(const id of ['theme-eyebrow','theme-tagline']){const el=root.querySelector<HTMLElement>(`#${id}`);if(el){el.textContent='';el.hidden=true;}}
 const logo=root.querySelector<HTMLImageElement>('#theme-logo');if(logo){logo.removeAttribute('src');logo.alt='';logo.hidden=true;}
}
export function applyProjectTheme(root:HTMLElement|null,state?:ProjectThemeState) {
 clearProjectTheme(root);if(!root||!state?.theme)return;
 const presentation=themePresentation(state.theme);if(!presentation)return;
 arrangeSections(root,presentation.theme.layout.order==='comparison-first');
 for(const [key,value] of Object.entries(presentation.variables))root.style.setProperty(key,value);
 for(const [key,value] of Object.entries(presentation.attributes))root.setAttribute(key,value);
 for(const [id,value] of [['theme-eyebrow',presentation.theme.brand.eyebrow],['theme-tagline',presentation.theme.brand.tagline]]){const el=root.querySelector<HTMLElement>(`#${id}`);if(el){el.textContent=value;el.hidden=!value;}}
}
