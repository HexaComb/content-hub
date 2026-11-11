export interface AuthConfig {provider:'clerk';publishableKey:string;frontendApiUrl:string}
/** Reject malformed/mismatched runtime configuration before loading a remote identity service. */
export function validateAuthConfig(config:AuthConfig):AuthConfig {
 if(config.provider!=='clerk'||!/^pk_(test|live)_[A-Za-z0-9_+/=-]+$/.test(config.publishableKey))throw new Error('Invalid identity configuration');
 const encoded=config.publishableKey.split('_').slice(2).join('_').replace(/-/g,'+').replace(/_/g,'/');
 const decoded=atob(encoded);const host=decoded.endsWith('$')?decoded.slice(0,-1):'';
 const url=new URL(config.frontendApiUrl);
 if(!host||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!['','/'].includes(url.pathname)||url.hostname!==host)throw new Error('Mismatched identity configuration');
 return config;
}
