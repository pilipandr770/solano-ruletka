import React from 'react'

type Props = {
  mode?: 'straight' | 'split' | 'street' | 'corner' | 'red' | 'black' | 'dozen' | 'column'
  selected?: number | null
  selectedPair?: [number, number] | null
  selectedCorner?: number[] | null
  selectedStreet?: number[] | null
  onSelect?: (n: number | null) => void
  onSelectPair?: (a: number, b: number) => void
  onSelectCorner?: (vals: number[] | null) => void
  onSelectStreet?: (vals: number[] | null) => void
  onSelectDozen?: (which: number) => void
  onSelectColumn?: (which: number) => void
  onSelectOutside?: (which: 'red'|'black'|'even'|'odd'|'low'|'high') => void
  // page-managed placed chips (array of bets)
  placedBets?: Array<{type: string, value: any, stake?: number}>
  // current bet type + stake (used when clicking the board to place immediately)
  currentBetType?: string
  currentStake?: number
  // callback when the user places a chip by clicking the board
  onPlace?: (bet: {type: string, value: any, stake?: number}) => void
  onRemove?: (index:number)=>void
}

const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

export default function RouletteBoardFixed(props: Props) {
  const { mode='straight', selected=null, onSelect, onSelectPair, onSelectCorner, onSelectStreet, onSelectDozen, onSelectColumn, onSelectOutside, placedBets = [], currentBetType = 'straight', currentStake = 1, onPlace, onRemove } = props
  const [hoverCell, setHoverCell] = React.useState<number|null>(null)
  const [hoverOverlay, setHoverOverlay] = React.useState<string|null>(null)
  const cols: number[][] = []
  for (let c=0;c<12;c++) cols.push([1+c*3,2+c*3,3+c*3])
  const cellW=64, cellH=56, gap=8, gridH = 3*cellH + 2*gap

  const dozenWidth = cellW*4 + gap*3 // 4 columns per dozen visually

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14, padding:12}}>
      {/* removed top visual boxes per request */}

      {/* board area */}
      <div style={{display:'flex',gap}}>
        {/* zero */}
        <div style={{width:56,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{width:56, height: gridH, borderRadius:28, background:'#0b6a4a', border:'2px solid #fff', display:'flex', alignItems:'center', justifyContent:'center'}} onClick={()=>{ onSelect && onSelect(0); if (onSelectDozen) {}; if (onPlace) onPlace({type: 'straight', value: 0, stake: currentStake}) }}>
            <span style={{color:'#fff', fontWeight:700}}>0</span>
          </div>
        </div>

        {/* number columns */}
        <div style={{display:'flex',gap}}>
          {cols.map((col,ci)=> (
            <div key={ci} style={{display:'flex',flexDirection:'column',gap}}>
              {col.map((n, ri)=> {
                const isRed = redSet.has(n)
                const colIdx = ci
                const rowIdx = ri
                const handleClick = () => {
                  if (currentBetType === 'straight') {
                    onSelect && onSelect(n)
                    onPlace && onPlace({type: 'straight', value: n, stake: currentStake})
                  } else if (currentBetType === 'street') {
                    const cIdx = Math.floor((n-1)/3)
                    const vals = [1+cIdx*3,2+cIdx*3,3+cIdx*3]
                    onSelectStreet && onSelectStreet(vals)
                    onPlace && onPlace({type: 'street', value: vals, stake: currentStake})
                  } else {
                    onSelect && onSelect(n)
                  }
                }
                // neighbor numbers for splits/corners
                const rightNeighbor = n + 3
                const bottomNeighbor = n + 1
                const bottomRight = n + 4
                const canSplitRight = colIdx < 11
                const canSplitDown = rowIdx < 2
                const canCorner = colIdx < 11 && rowIdx < 2

                const isMinForBet = (b:any) => {
                  if (!Array.isArray(b.value)) return false
                  return Math.min(...b.value) === n
                }

                return (
                  <div key={n}
                    onMouseEnter={()=>setHoverCell(n)} onMouseLeave={()=>setHoverCell(null)}
                    style={{width:cellW,height:cellH, background: hoverCell===n? '#155d45':'#0b6a4a', border: hoverCell===n? '2px solid #ffd700':'1px solid rgba(255,255,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative'}}>
                    <button onClick={handleClick} style={{width:'100%',height:'100%',background:'transparent',border:'none',color:isRed? '#e24d4d':'#111', fontWeight:800, fontSize:16}}>{n}</button>
                    {/* horizontal split handle */}
                    {canSplitRight && (
                      <div onMouseEnter={()=>setHoverOverlay(`split-${n}-${rightNeighbor}`)} onMouseLeave={()=>setHoverOverlay(null)} onClick={(e)=>{ e.stopPropagation(); onPlace && onPlace({type:'split', value:[n, rightNeighbor], stake: currentStake}) }} style={{position:'absolute', right:-Math.floor(gap/2), top:'50%', transform:'translateY(-50%)', width:12, height:28, background:hoverOverlay===`split-${n}-${rightNeighbor}`? 'rgba(255,255,0,0.18)':'rgba(255,255,255,0.06)', cursor:'pointer'}} />
                    )}
                    {/* vertical split handle */}
                    {canSplitDown && (
                      <div onMouseEnter={()=>setHoverOverlay(`split-${n}-${bottomNeighbor}`)} onMouseLeave={()=>setHoverOverlay(null)} onClick={(e)=>{ e.stopPropagation(); onPlace && onPlace({type:'split', value:[n, bottomNeighbor], stake: currentStake}) }} style={{position:'absolute', bottom:-Math.floor(gap/2), left:'50%', transform:'translateX(-50%)', width:28, height:12, background:hoverOverlay===`split-${n}-${bottomNeighbor}`? 'rgba(255,255,0,0.18)':'rgba(255,255,255,0.06)', cursor:'pointer'}} />
                    )}
                    {/* corner handle */}
                    {canCorner && (
                      <div onMouseEnter={()=>setHoverOverlay(`corner-${n}`)} onMouseLeave={()=>setHoverOverlay(null)} onClick={(e)=>{ e.stopPropagation(); onPlace && onPlace({type:'corner', value:[n, bottomNeighbor, rightNeighbor, bottomRight], stake: currentStake}) }} style={{position:'absolute', right:-Math.floor(gap/2), bottom:-Math.floor(gap/2), width:18, height:18, background:hoverOverlay===`corner-${n}`? 'rgba(255,128,128,0.22)':'rgba(255,255,255,0.08)', cursor:'pointer'}} />
                    )}

                    {/* placed chips overlay (show stake for straight bets) */}
                    {placedBets.filter((b:any)=>b.type==='straight' && b.value===n).map((b,idx)=> (
                      <div key={idx} onClick={(e)=>{ e.stopPropagation(); onRemove && onRemove((placedBets as any).indexOf(b)) }} title="Remove chip" style={{position:'absolute', right:6, bottom:6, background:'#ffd700', borderRadius:12, padding:'2px 6px', fontSize:12, fontWeight:700, cursor:'pointer'}}>{b.stake||1}</div>
                    ))}

                    {/* placed split/corner markers shown on the top-left cell of their values */}
                    {placedBets.filter((b:any)=> (b.type==='split' || b.type==='corner') && Array.isArray(b.value) && Math.min(...b.value)===n).map((b,idx)=> (
                      <div key={idx} onClick={(e)=>{ e.stopPropagation(); onRemove && onRemove((placedBets as any).indexOf(b)) }} title="Remove bet" style={{position:'absolute', left:6, top:6, background:b.type==='split'?'#88f':'#f88', borderRadius:6, padding:'2px 6px', fontSize:11, fontWeight:700, cursor:'pointer'}}>{(b.value.length||0)}</div>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* three row-selection buttons (one per horizontal row) */}
        <div style={{width:72, display:'flex',flexDirection:'column', alignItems:'center', justifyContent:'space-between'}}>
          {[0,1,2].map((rowIdx)=> (
            <button key={rowIdx} onClick={()=>{ onSelectColumn && onSelectColumn(rowIdx+1); if (onPlace) onPlace({type:'column', value: rowIdx+1, stake: currentStake}) }} style={{width:56, height:cellH, borderRadius:6, background:'#0b6a4a', color:'#fff', border:'2px solid #fff', writingMode:'vertical-rl', textOrientation:'mixed', transform:'rotate(180deg)'}}>
              2 to 1
            </button>
          ))}
        </div>
      </div>

      {/* dozens row */}
      <div style={{display:'flex', width: 56 + 12*(cellW+gap) + 56, justifyContent:'center'}}>
        <div style={{width:56}} />
        <div style={{display:'flex', gap}}>
          <button onClick={()=>{ onSelectDozen && onSelectDozen(1); if (onPlace) onPlace({type:'dozen', value:1, stake: currentStake}) }} style={{width:dozenWidth, height:52, background:'#0b6a4a', color:'#fff', border:'2px solid #fff', borderRadius:6}}>1st 12</button>
          <button onClick={()=>{ onSelectDozen && onSelectDozen(2); if (onPlace) onPlace({type:'dozen', value:2, stake: currentStake}) }} style={{width:dozenWidth, height:52, background:'#0b6a4a', color:'#fff', border:'2px solid #fff', borderRadius:6}}>2nd 12</button>
          <button onClick={()=>{ onSelectDozen && onSelectDozen(3); if (onPlace) onPlace({type:'dozen', value:3, stake: currentStake}) }} style={{width:dozenWidth, height:52, background:'#0b6a4a', color:'#fff', border:'2px solid #fff', borderRadius:6}}>3rd 12</button>
        </div>
        <div style={{width:56}} />
      </div>

      {/* outside bets row */}
      <div style={{display:'flex', width: 56 + 12*(cellW+gap) + 56, justifyContent:'center'}}>
        <div style={{width:56}} />
        <div style={{display:'flex', gap}}>
          <button onClick={()=>{ onSelectOutside && onSelectOutside('low'); if (onPlace) onPlace({type:'low', value:'1-18', stake: currentStake}) }} style={{width:dozenWidth/3, height:48, background:'#0b6a4a', color:'#fff', borderRadius:6}}>1 to 18</button>
          <button onClick={()=>{ onSelectOutside && onSelectOutside('even'); if (onPlace) onPlace({type:'even', value:'even', stake: currentStake}) }} style={{width:dozenWidth/3, height:48, background:'#ccc', color:'#000', borderRadius:6}}>Even</button>
          <div style={{width:80, display:'flex', justifyContent:'center', alignItems:'center'}}>
            <button onClick={()=>{ onSelectOutside && onSelectOutside('red'); if (onPlace) onPlace({type:'red', value:'red', stake: currentStake}) }} style={{width:44, height:40, background:'#e24d4d', borderRadius:6, marginRight:8,border:'none'}} />
            <button onClick={()=>{ onSelectOutside && onSelectOutside('black'); if (onPlace) onPlace({type:'black', value:'black', stake: currentStake}) }} style={{width:44, height:40, background:'#111', borderRadius:6,border:'none'}} />
          </div>
          <button onClick={()=>{ onSelectOutside && onSelectOutside('odd'); if (onPlace) onPlace({type:'odd', value:'odd', stake: currentStake}) }} style={{width:dozenWidth/3, height:48, background:'#ccc', color:'#000', borderRadius:6}}>Odd</button>
          <button onClick={()=>{ onSelectOutside && onSelectOutside('high'); if (onPlace) onPlace({type:'high', value:'19-36', stake: currentStake}) }} style={{width:dozenWidth/3, height:48, background:'#0b6a4a', color:'#fff', borderRadius:6}}>19 to 36</button>
        </div>
        <div style={{width:56}} />
      </div>
    </div>
  )
}
