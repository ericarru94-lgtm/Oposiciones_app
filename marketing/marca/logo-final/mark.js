// Polished circuit monogram. bg = background colour (terminals are hollow), t = line colour.
const O='#FF4B2B';
module.exports=(t,bg,{sw=7,tr=6.5,tw=4.5}={})=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g transform="translate(-12 0)">
<g stroke="${t}" stroke-width="${sw}" stroke-linecap="round" fill="none">
<path d="M46 ${62+tr} V${138-tr} M90 ${62+tr} V${138-tr} M46 100 H90"/>
<path d="M120 62 V138 M120 62 H${162-tr} M120 138 H${162-tr} M120 100 H150"/></g>
<g fill="${bg}" stroke="${t}" stroke-width="${tw}"><circle cx="46" cy="62" r="${tr}"/><circle cx="46" cy="138" r="${tr}"/><circle cx="90" cy="62" r="${tr}"/><circle cx="90" cy="138" r="${tr}"/><circle cx="162" cy="62" r="${tr}"/><circle cx="162" cy="138" r="${tr}"/></g>
<circle cx="162" cy="100" r="${tr+2.5}" fill="${O}"/>
<path d="M178 86 A20 20 0 0 1 178 114" stroke="${O}" stroke-width="${tw}" fill="none" stroke-linecap="round"/>
<path d="M188 78 A32 32 0 0 1 188 122" stroke="${O}" stroke-width="${tw*0.7}" fill="none" stroke-linecap="round"/>
</g></svg>`;
