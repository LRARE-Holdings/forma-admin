/**
 * Fitting a name onto Lucy's gift voucher.
 *
 * Advance widths of Cormorant Garamond SemiBold Italic (the voucher's
 * handwritten-style fields), in thousandths of an em, measured from the font
 * file. Summing these matches the font's real width of a whole name to within
 * about 0.3%, which a flat "average letter" guess did not: it cut
 * "Mum, Dad & Chloé" off as "Mum, Dad & Ch…".
 *
 * The same file lives in burn-public (lib/voucher-fit.ts) so the live preview
 * on the website shrinks names exactly the way the PDF does. Keep them equal.
 */
const WIDTHS: Record<string, number> = {" ":234,"!":219,"\"":331,"#":441,"$":394,"%":526,"&":760,"'":136,"(":287,")":287,"*":448,"+":398,",":231,"-":305,".":204,"/":305,"0":445,"1":291,"2":369,"3":350,"4":430,"5":374,"6":423,"7":390,"8":440,"9":424,":":204,";":222,"<":407,"=":468,">":407,"?":295,"@":726,"A":603,"B":547,"C":587,"D":628,"E":525,"F":484,"G":632,"H":674,"I":326,"J":304,"K":615,"L":502,"M":739,"N":654,"O":654,"P":522,"Q":654,"R":628,"S":467,"T":553,"U":619,"V":597,"W":830,"X":580,"Y":533,"Z":554,"[":251,"\\":305,"]":250,"^":353,"_":363,"`":166,"a":441,"b":445,"c":346,"d":448,"e":352,"f":266,"g":385,"h":452,"i":247,"j":246,"k":414,"l":244,"m":682,"n":472,"o":405,"p":406,"q":419,"r":350,"s":311,"t":299,"u":472,"v":442,"w":625,"x":427,"y":449,"z":344,"{":262,"|":152,"}":263,"~":443,"À":603,"Á":603,"Â":603,"Ã":603,"Ä":603,"Å":603,"Æ":771,"Ç":587,"È":525,"É":525,"Ê":525,"Ë":525,"Ì":326,"Í":326,"Î":326,"Ï":326,"Ñ":654,"Ò":654,"Ó":654,"Ô":654,"Õ":654,"Ö":654,"Ø":654,"Ù":619,"Ú":619,"Û":619,"Ü":619,"Ý":533,"à":441,"á":441,"â":441,"ã":441,"ä":441,"å":441,"æ":572,"ç":346,"è":352,"é":352,"ê":352,"ë":352,"ì":247,"í":247,"î":247,"ï":247,"ñ":472,"ò":405,"ó":405,"ô":405,"õ":405,"ö":405,"ø":408,"ù":472,"ú":472,"û":472,"ü":472,"ý":449,"ÿ":449,"Ł":502,"ł":255,"Œ":808,"œ":609,"Š":467,"š":311,"Ž":554,"ž":344,"Ğ":632,"ğ":385,"Ş":467,"ş":311,"İ":326,"ı":247,"Ć":587,"ć":346,"Č":587,"č":346,"Ę":525,"ę":354,"Ń":654,"ń":472,"Ś":467,"ś":311,"Ź":554,"ź":344,"Ż":554,"ż":344,"Ř":628,"ř":350,"Ů":619,"ů":472,"Ď":628,"ď":448,"Ť":553,"ť":299,"Ě":525,"ě":352,"Ň":654,"ň":472,"Đ":628,"đ":436,"’":188,"‘":187,"“":344,"”":345,"–":515,"—":830,"…":672,"€":534,"£":388}

/** Characters outside the table: CJK and emoji are wide, the rest about average. */
function fallbackWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 0x1f000) return 1150 // emoji
  if (cp >= 0x2e80) return 1000 // CJK and other full-width scripts
  return 600
}

/** Width of `text` in em at this font. */
export function voucherTextWidthEm(text: string): number {
  let total = 0
  for (const ch of text) total += WIDTHS[ch] ?? fallbackWidth(ch)
  return total / 1000
}

/**
 * Font size (px) that fits `text` into `maxWidth` px, starting from the
 * design size and never below `minRatio` of it. A 4% margin covers kerning
 * and renderer differences. Past the minimum the field clips with an ellipsis.
 */
export function fitVoucherFontSize(text: string, designSize: number, maxWidth: number, minRatio = 0.45): number {
  const em = voucherTextWidthEm(text) * 1.04
  if (em * designSize <= maxWidth) return designSize
  return Math.max(Math.floor((maxWidth / em) * 10) / 10, Math.round(designSize * minRatio))
}
