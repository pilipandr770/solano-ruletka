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
  onSelectOutside?: (which: 'red'|'black'|'even'|'odd'|'low'|'high') => void
}

const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

export default function RouletteBoard(props: Props) {
  const { mode = 'straight', selected = null, selectedPair = null, selectedCorner = null, selectedStreet = null, onSelect, onSelectPair, onSelectCorner, onSelectStreet, onSelectDozen, onSelectOutside } = props

  const columns: number[][] = []
  for (let col = 0; col < 12; col++) {
    const colVals: number[] = []
    for (let r = 0; r < 3; r++) colVals.push(1 + col * 3 + r)
    columns.push(colVals)
  }

  const cellW = 56
  const cellH = 48
  const gap = 6
  const gridHeight = 3 * cellH + 2 * gap

  const handleNumberClick = (n: number) => {
    if (mode === 'split') { if (!selectedPair) { onSelectPair && onSelectPair(n, n); return } ; return }
    if (mode === 'corner') { onSelectCorner && onSelectCorner([n]); return }
    onSelect && onSelect(n)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', width: 56 + 12 * (cellW + gap) + 48, justifyContent: 'center' }}>
        <div style={{ width: 56 }} />
        <div style={{ display: 'flex', gap }}>
          {columns.map((_, i) => (
            <div key={`top-${i}`} style={{ width: cellW, height: 24, background: '#0b6a4a', border: '1px solid #fff' }} />
          ))}
        </div>
        <div style={{ width: 48 }} />
      </div>

      <div style={{ display: 'flex', gap }}>
        <div style={{ width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => handleNumberClick(0)} aria-label="num-0" style={{ width: 56, height: gridHeight, borderRadius: 12, background: selected === 0 ? '#0b5cff' : '#0b6a4a', color: '#fff', border: '2px solid #fff' }}>0</button>
        </div>

        <div style={{ display: 'flex', gap }}>
          {columns.map((col, colIdx) => (
            <div key={`col-${colIdx}`} style={{ display: 'flex', flexDirection: 'column', gap }}>
              {col.map((n, rIdx) => (
                <div key={`cell-${n}`} style={{ position: 'relative', width: cellW, height: cellH }}>
                  <button onClick={() => handleNumberClick(n)} aria-label={`num-${n}`} style={{ width: cellW, height: cellH, borderRadius: 4, background: (selected === n) ? '#0b5cff' : '#0c5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #fff' }}>
                    <span style={{ color: redSet.has(n) ? '#e24d4d' : '#000', fontWeight: 700 }}>{n}</span>
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ width: 48, display: 'flex', flexDirection: 'column', gap }}>
          {columns.map((col, i) => (
            <div key={`street-${i}`} style={{ width: 48, height: cellH, borderRadius: 6, background: '#eee', border: '1px solid #bbb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2 to 1</div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', width: 56 + 12 * (cellW + gap) + 48, gap, justifyContent: 'center', marginTop: 8 }}>
        <div style={{ width: 56 }} />
        <div style={{ display: 'flex', gap }}>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#0b6a4a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1 to 18</div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Even</div>
          <div style={{ width: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ width: 48, height: 48, background: 'red', borderRadius: 6 }} />
            <div style={{ width: 48, height: 48, background: 'black', borderRadius: 6 }} />
          </div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Odd</div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#0b6a4a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>19 to 36</div>
        </div>
        <div style={{ width: 48 }} />
      </div>
    </div>
  )
}
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
  onSelectOutside?: (which: 'red'|'black'|'even'|'odd'|'low'|'high') => void
}

const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

export default function RouletteBoard({
  mode = 'straight',
  selected = null,
  selectedPair = null,
  selectedCorner = null,
  selectedStreet = null,
  onSelect,
  onSelectPair,
  onSelectCorner,
  onSelectStreet,
  onSelectDozen,
  onSelectOutside
}: Props) {
  const columns: number[][] = []
  for (let col = 0; col < 12; col++) {
    const colVals: number[] = []
    for (let r = 0; r < 3; r++) colVals.push(1 + col * 3 + r)
    columns.push(colVals)
  }

  const cellW = 56
  const cellH = 48
  const gap = 6
  const gridHeight = 3 * cellH + 2 * gap

  const handleNumberClick = (n: number) => {
    if (mode === 'split') {
      if (!selectedPair) { onSelectPair && onSelectPair(n, n); return }
      return
    }
    if (mode === 'corner') { onSelectCorner && onSelectCorner([n]); return }
    onSelect && onSelect(n)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', width: 56 + 12 * (cellW + gap) + 48, justifyContent: 'center' }}>
        <div style={{ width: 56 }} />
        <div style={{ display: 'flex', gap }}>
          {columns.map((_, i) => (
            <div key={`top-${i}`} style={{ width: cellW, height: 24, background: '#0b6a4a', border: '1px solid #fff' }} />
          ))}
        </div>
        <div style={{ width: 48 }} />
      </div>

      <div style={{ display: 'flex', gap }}>
        <div style={{ width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => handleNumberClick(0)} aria-label="num-0" style={{ width: 56, height: gridHeight, borderRadius: 12, background: selected === 0 ? '#0b5cff' : '#0b6a4a', color: '#fff', border: '2px solid #fff' }}>0</button>
        </div>

        <div style={{ display: 'flex', gap }}>
          {columns.map((col, colIdx) => (
            <div key={`col-${colIdx}`} style={{ display: 'flex', flexDirection: 'column', gap }}>
              {col.map((n, rIdx) => {
                const isRed = redSet.has(n)
                const color = isRed ? '#e24d4d' : '#000'
                const isSelectedStraight = selected === n
                const isInSelectedPair = selectedPair && (selectedPair[0] === n || selectedPair[1] === n)
                const isInSelectedCorner = selectedCorner && selectedCorner.includes(n)
                const isInSelectedStreet = selectedStreet && selectedStreet.includes(n)
                return (
                  <div key={`cell-${n}`} style={{ position: 'relative', width: cellW, height: cellH }}>
                    <button onClick={() => handleNumberClick(n)} aria-label={`num-${n}`} style={{ width: cellW, height: cellH, borderRadius: 4, background: isSelectedStraight ? '#0b5cff' : '#0c5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: isInSelectedPair || isInSelectedCorner || isInSelectedStreet ? '2px solid #0b5cff' : '1px solid #fff' }}>
                      <span style={{ color, fontWeight: 700 }}>{n}</span>
                    </button>

                    {colIdx < 11 && (
                      <button onClick={() => { if (mode === 'split') onSelectPair && onSelectPair(n, columns[colIdx + 1][rIdx]) }} aria-label={`split-${n}`} style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', width: 20, height: 18, borderRadius: 4, background: '#eee', border: '1px solid #bbb' }} />
                    )}
                    {rIdx < 2 && (
                      <button onClick={() => { if (mode === 'split') onSelectPair && onSelectPair(n, columns[colIdx][rIdx + 1]) }} aria-label={`split-${n}`} style={{ position: 'absolute', left: '50%', bottom: -12, transform: 'translateX(-50%)', width: 20, height: 18, borderRadius: 4, background: '#eee', border: '1px solid #bbb' }} />
                    )}
                    {colIdx < 11 && rIdx < 2 && (
                      <button onClick={() => { if (onSelectCorner) onSelectCorner([n, columns[colIdx + 1][rIdx], columns[colIdx][rIdx + 1], columns[colIdx + 1][rIdx + 1]]) }} aria-label={`corner-${n}`} style={{ position: 'absolute', right: -12, bottom: -12, width: 16, height: 16, borderRadius: 3, background: '#eee', border: '1px solid #bbb' }} />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div style={{ width: 48, display: 'flex', flexDirection: 'column', gap }}>
          {columns.map((col, i) => (
            <button key={`street-${i}`} onClick={() => { if (onSelectStreet) onSelectStreet(col) }} aria-label={`street-${i}`} style={{ width: 48, height: cellH, borderRadius: 6, background: (selectedStreet && selectedStreet.length === 3 && selectedStreet.every(v => col.includes(v))) ? '#0b5cff' : '#eee', border: '1px solid #bbb' }}>2 to 1</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', width: 56 + 12 * (cellW + gap) + 48, gap, justifyContent: 'center', marginTop: 8 }}>
        <div style={{ width: 56 }} />
        <div style={{ display: 'flex', gap }}>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#0b6a4a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => onSelectOutside && onSelectOutside('low')}>1 to 18</div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => onSelectOutside && onSelectOutside('even')}>Even</div>
          <div style={{ width: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ width: 48, height: 48, background: 'red', borderRadius: 6 }} onClick={() => onSelectOutside && onSelectOutside('red')} />
            <div style={{ width: 48, height: 48, background: 'black', borderRadius: 6 }} onClick={() => onSelectOutside && onSelectOutside('black')} />
          </div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => onSelectOutside && onSelectOutside('odd')}>Odd</div>
          <div style={{ width: (cellW * 3 + gap * 2) / 3, height: 56, background: '#0b6a4a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => onSelectOutside && onSelectOutside('high')}>19 to 36</div>
        </div>
        <div style={{ width: 48 }} />
      </div>
    </div>
  )
}
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
  onSelectOutside?: (which: 'red'|'black'|'even'|'odd'|'low'|'high') => void
}

const redSet = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

export default function RouletteBoard({
  mode = 'straight',
  selected = null,
  selectedPair = null,
  selectedCorner = null,
  selectedStreet = null,
  onSelect,
  onSelectPair,
  onSelectCorner,
  onSelectStreet,
  onSelectDozen,
  onSelectOutside
}: Props) {
  const columns: number[][] = []
  for (let col = 0; col < 12; col++) {
    const colVals: number[] = []
    for (let r = 0; r < 3; r++) colVals.push(1 + col * 3 + r)
    columns.push(colVals)
  }

  const cellW = 72
  const cellH = 48
  const gap = 6
  const gridHeight = 12 * cellH + 11 * gap
  const gridHeight = 3 * cellH + 2 * gap

  const handleNumberClick = (n: number) => {
    if (mode === 'split') {
      if (!selectedPair) {
        onSelectPair && onSelectPair(n, n)
        return
      }
      return
    }
    if (mode === 'corner') {
      onSelectCorner && onSelectCorner([n])
      return
    }
    onSelect && onSelect(n)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <button
            onClick={() => handleNumberClick(0)}
            style={{ width: 56, height: gridHeight, borderRadius: 12, background: selected === 0 ? '#0b5cff' : '#0b6a4a', color: '#fff', border: '2px solid #fff' }}
            aria-label="num-0"
          >
            0
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
          {rows.slice().reverse().map((row, rIdx) => {
            const street = [...row]
            return (
              <div key={`row-${rIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {row.map((n, cIdx) => {
                  const isRed = redSet.has(n)
                  const color = isRed ? '#e24d4d' : '#000'
                  const right = cIdx < 2 ? row[cIdx + 1] : null
                  const below = rIdx < 11 ? rows[rIdx + 1][cIdx] : null
                  const belowRight = (rIdx < 11 && cIdx < 2) ? rows[rIdx + 1][cIdx + 1] : null

                  const isSelectedStraight = selected === n
                  const isInSelectedPair = selectedPair && (selectedPair[0] === n || selectedPair[1] === n)
                  const isInSelectedCorner = selectedCorner && selectedCorner.includes(n)
                  const isInSelectedStreet = selectedStreet && selectedStreet.includes(n)

                  return (
                    <div key={`cell-${n}`} style={{ position: 'relative', width: cellW, height: cellH }}>
                      <button
                        onClick={() => handleNumberClick(n)}
                        aria-label={`num-${n}`}
                        style={{ width: cellW, height: cellH, borderRadius: 4, background: isSelectedStraight ? '#0b5cff' : '#0c5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: isInSelectedPair || isInSelectedCorner || isInSelectedStreet ? '2px solid #0b5cff' : '1px solid #fff' }}
                      >
                        <span style={{ color, fontWeight: 700 }}>{n}</span>
                      </button>

                      {right && (
                        <button
                          onClick={() => { if (mode === 'split') onSelectPair && onSelectPair(n, right) }}
                          aria-label={`split-${n}-${right}`}
                          style={{ position: 'absolute', right: -18, top: '50%', transform: 'translateY(-50%)', width: 24, height: 20, borderRadius: 4, background: (selectedPair && ((selectedPair[0]===n&&selectedPair[1]===right)||(selectedPair[0]===right&&selectedPair[1]===n))) ? '#0b5cff' : '#eee', border: '1px solid #bbb', cursor: 'pointer' }}
                        />
                      )}
                      {below && (
                        <button
                          onClick={() => { if (mode === 'split') onSelectPair && onSelectPair(n, below) }}
                          aria-label={`split-${n}-${below}`}
                          style={{ position: 'absolute', left: '50%', bottom: -14, transform: 'translateX(-50%)', width: 24, height: 20, borderRadius: 4, background: (selectedPair && ((selectedPair[0]===n&&selectedPair[1]===below)||(selectedPair[0]===below&&selectedPair[1]===n))) ? '#0b5cff' : '#eee', border: '1px solid #bbb', cursor: 'pointer' }}
                        />
                      )}

                      {below && right && belowRight && (
                        <button
                          onClick={() => { if (onSelectCorner) onSelectCorner([n, right, below, belowRight]) }}
                          aria-label={`corner-${n}-${right}-${below}-${belowRight}`}
                          style={{ position: 'absolute', right: -18, bottom: -14, transform: 'translate(0,0)', width: 20, height: 20, borderRadius: 4, background: (selectedCorner && selectedCorner.length===4 && selectedCorner.every(v=>[n,right,below,belowRight].includes(v))) ? '#0b5cff' : '#eee', border: '1px solid #bbb', cursor: 'pointer' }}
                        />
                      )}

                      {isSelectedStraight && (
                        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 20, height: 20, borderRadius: 10, background: '#ffcc33', border: '2px solid #c66' }} />
                      )}

                      {selectedPair && ((selectedPair[0]===n && selectedPair[1]===right) || (selectedPair[1]===n && selectedPair[0]===right)) && (
                        <div style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: 9, background: '#ffcc33', border: '2px solid #c66' }} />
                      )}
                      {selectedPair && ((selectedPair[0]===n && selectedPair[1]===below) || (selectedPair[1]===n && selectedPair[0]===below)) && (
                        <div style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 18, height: 18, borderRadius: 9, background: '#ffcc33', border: '2px solid #c66' }} />
                      )}

                      {selectedCorner && selectedCorner.length===4 && (() => {
                        const quad = selectedCorner.slice().sort((a,b)=>a-b)
                        if (quad.includes(n) && n === Math.min(...quad)) {
                          return (<div style={{ position: 'absolute', right: -6, bottom: -6, width: 18, height: 18, borderRadius: 9, background: '#ffcc33', border: '2px solid #c66' }} />)
                        }
                        return null
                      })()}
                    </div>
                  )
                })}

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => { if (onSelectStreet) onSelectStreet(street) }}
                    aria-label={`street-${street.join('-')}`}
                    style={{ width: 48, height: cellH, borderRadius: 6, background: (selectedStreet && selectedStreet.length===3 && selectedStreet.every(v=>street.includes(v))) ? '#0b5cff' : '#eee', border: '1px solid #bbb', marginLeft:6, writingMode: 'vertical-rl', textOrientation:'mixed' }}
                  >
                    2 to 1
                  </button>
                  {selectedStreet && selectedStreet.length===3 && selectedStreet.every(v=>street.includes(v)) && (
                    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 18, height: 18, borderRadius: 9, background: '#ffcc33', border: '2px solid #c66' }} />
                  )}
                </div>
              </div>
            )
                      {columns.map((col, colIdx) => (
        </div>
                          {col.map((n, rIdx) => {

      <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'center', width: (cellW*3 + gap*2 + 56 + 48 + 40) }}>
        {[1,2,3].map(d => (
          <button key={d} onClick={() => { if (onSelectDozen) onSelectDozen(d) }} style={{ flex:1, height: 56, background: (mode === 'dozen' && (selected as any) === d) ? '#0b5cff' : '#0b6', color:'#fff', border:'2px solid #2a7', borderRadius:6 }}>
            {d===1? '1st 12' : d===2? '2nd 12' : '3rd 12'}
          </button>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginTop:8, justifyContent:'center', alignItems:'center', width: (cellW*3 + gap*2 + 56 + 48 + 40) }}>
        <button onClick={() => onSelectOutside && onSelectOutside('low')} style={{ flex:1, height: 48, background: '#0b6', borderRadius:6 }}>1 to 18</button>
        <button onClick={() => onSelectOutside && onSelectOutside('even')} style={{ flex:1, height: 48, background: '#ccc', borderRadius:6 }}>Even</button>
        <div style={{ width: 80, display:'flex', justifyContent:'center', alignItems:'center' }}>
          <button onClick={() => onSelectOutside && onSelectOutside('red')} style={{ width: 48, height: 48, background: 'red', color:'#fff', borderRadius:6 }} />
          <button onClick={() => onSelectOutside && onSelectOutside('black')} style={{ width: 48, height: 48, background: 'black', color:'#fff', borderRadius:6, marginLeft:8 }} />
        </div>
        <button onClick={() => onSelectOutside && onSelectOutside('odd')} style={{ flex:1, height: 48, background: '#ccc', borderRadius:6 }}>Odd</button>
        <button onClick={() => onSelectOutside && onSelectOutside('high')} style={{ flex:1, height: 48, background: '#0b6', borderRadius:6 }}>19 to 36</button>
      </div>
    </div>
  )
}
