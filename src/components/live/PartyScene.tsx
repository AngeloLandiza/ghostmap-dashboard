/**
 * The live 3D scene for `/parties/:id` (PLAN section 4).
 *
 * Lazily imported so three.js and @react-three/fiber stay out of every other route, and driven
 * imperatively: the {@link LiveStore} owns the growing typed arrays, and this component keeps one
 * `THREE.Points`, one trajectory `THREE.Line` and one frustum per device in sync with them inside
 * a single `useFrame`. React never re-renders on incoming data — a 3 Hz keyframe stream across
 * four phones would otherwise reconcile the tree hundreds of times a minute.
 *
 * Buffer growth is the reason for the two counters on each buffer: `generation` changes only when
 * the backing `Float32Array` is replaced (rebuild the geometry), `revision` changes on every
 * append (flag `needsUpdate` and move the draw range).
 */
import { memo, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { DeviceLayer, LiveStore } from '../../lib/realtime/liveStore'

const FALLBACK_COLOR = '#8aa0b8'
/** Frustum wireframe size in metres — a phone-sized marker at room scale. */
const FRUSTUM_DEPTH = 0.14

interface LayerObjects {
  points: THREE.Points
  pointsMaterial: THREE.PointsMaterial
  pointsGeneration: number
  pointsRevision: number
  line: THREE.Line
  lineMaterial: THREE.LineBasicMaterial
  lineGeneration: number
  lineRevision: number
  frustum: THREE.LineSegments
  frustumMaterial: THREE.LineBasicMaterial
  color: string
}

/** Apex at the origin looking down -Z, like an ARKit camera. */
function frustumGeometry(depth = FRUSTUM_DEPTH): THREE.BufferGeometry {
  const w = depth * 0.72
  const h = depth * 0.54
  const c: [number, number, number][] = [
    [-w, -h, -depth],
    [w, -h, -depth],
    [w, h, -depth],
    [-w, h, -depth],
  ]
  const apex: [number, number, number] = [0, 0, 0]
  const segments: [number, number, number][] = []
  for (const corner of c) segments.push(apex, corner)
  for (let i = 0; i < 4; i += 1) segments.push(c[i] as [number, number, number], c[(i + 1) % 4] as [number, number, number])
  const positions = new Float32Array(segments.length * 3)
  segments.forEach((p, i) => positions.set(p, i * 3))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function makeObjects(layer: DeviceLayer, pointSize: number): LayerObjects {
  const color = new THREE.Color(layer.color || FALLBACK_COLOR)

  const pointsMaterial = new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
  })
  const points = new THREE.Points(new THREE.BufferGeometry(), pointsMaterial)
  // The buffers hold unwritten tail capacity, so a computed bounding sphere would be wrong.
  points.frustumCulled = false

  const lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial)
  line.frustumCulled = false

  const frustumMaterial = new THREE.LineBasicMaterial({ color })
  const frustum = new THREE.LineSegments(frustumGeometry(), frustumMaterial)
  frustum.matrixAutoUpdate = false
  frustum.frustumCulled = false
  frustum.visible = false

  return {
    points,
    pointsMaterial,
    pointsGeneration: -1,
    pointsRevision: -1,
    line,
    lineMaterial,
    lineGeneration: -1,
    lineRevision: -1,
    frustum,
    frustumMaterial,
    color: layer.color,
  }
}

function disposeObjects(o: LayerObjects): void {
  o.points.geometry.dispose()
  o.pointsMaterial.dispose()
  o.line.geometry.dispose()
  o.lineMaterial.dispose()
  o.frustum.geometry.dispose()
  o.frustumMaterial.dispose()
}

export interface LiveLayersProps {
  store: LiveStore
  paused: boolean
  showTrajectories: boolean
  showFrustums: boolean
  pointSize: number
}

function LiveLayers({ store, paused, showTrajectories, showFrustums, pointSize }: LiveLayersProps): JSX.Element {
  const group = useRef<THREE.Group>(null)
  const objects = useRef(new Map<string, LayerObjects>())
  const matrix = useRef(new THREE.Matrix4())

  useEffect(() => {
    const map = objects.current
    return () => {
      for (const o of map.values()) disposeObjects(o)
      map.clear()
    }
  }, [])

  useEffect(() => {
    for (const o of objects.current.values()) o.pointsMaterial.size = pointSize
  }, [pointSize])

  useFrame(() => {
    const root = group.current
    if (!root || paused) return

    for (const layer of store.layers.values()) {
      let o = objects.current.get(layer.deviceId)
      if (!o) {
        o = makeObjects(layer, pointSize)
        objects.current.set(layer.deviceId, o)
        root.add(o.points, o.line, o.frustum)
      }

      // A colour can arrive after the first keyframe (the participant row lands late).
      if (layer.color && layer.color !== o.color) {
        o.color = layer.color
        const c = new THREE.Color(layer.color)
        o.lineMaterial.color = c
        o.frustumMaterial.color = c
      }

      // --- point cloud -------------------------------------------------------------
      const buffer = layer.points
      if (buffer.generation !== o.pointsGeneration) {
        o.points.geometry.dispose()
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(buffer.positions, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(buffer.colors, 3))
        o.points.geometry = geometry
        o.pointsGeneration = buffer.generation
        o.pointsRevision = -1
      }
      if (buffer.revision !== o.pointsRevision) {
        const geometry = o.points.geometry
        const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
        const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
        if (position) position.needsUpdate = true
        if (color) color.needsUpdate = true
        geometry.setDrawRange(0, buffer.count)
        o.pointsRevision = buffer.revision
      }
      o.points.visible = buffer.count > 0

      // --- trajectory --------------------------------------------------------------
      const track = layer.trajectory
      if (track.generation !== o.lineGeneration) {
        o.line.geometry.dispose()
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(track.positions, 3))
        o.line.geometry = geometry
        o.lineGeneration = track.generation
        o.lineRevision = -1
      }
      if (track.revision !== o.lineRevision) {
        const position = o.line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
        if (position) position.needsUpdate = true
        o.line.geometry.setDrawRange(0, track.count)
        o.lineRevision = track.revision
      }
      o.line.visible = showTrajectories && track.count > 1

      // --- frustum -----------------------------------------------------------------
      if (showFrustums && layer.latestPose && layer.latestPose.length >= 16) {
        matrix.current.fromArray(layer.latestPose)
        o.frustum.matrix.copy(matrix.current)
        o.frustum.visible = true
        // An unaligned pose is not in the party frame yet; show it, but muted.
        o.frustumMaterial.color.set(layer.latestPoseAligned ? layer.color || FALLBACK_COLOR : '#6b7280')
      } else {
        o.frustum.visible = false
      }
    }
  })

  return <group ref={group} />
}

interface CameraRigProps {
  store: LiveStore
  /** Incremented by the "Recenter" button. */
  recenterToken: number
}

/** Frames the cloud once it exists, and again whenever the user asks to recenter. */
function CameraRig({ store, recenterToken }: CameraRigProps): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const framed = useRef(false)
  const token = useRef(recenterToken)

  useFrame(() => {
    const manual = token.current !== recenterToken
    if (!manual && framed.current) return
    if (!store.hasBounds) return
    const bounds = store.currentBounds()

    const cx = (bounds.min[0] + bounds.max[0]) / 2
    const cy = (bounds.min[1] + bounds.max[1]) / 2
    const cz = (bounds.min[2] + bounds.max[2]) / 2
    const span = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
      1,
    )
    // A 55 degree fov needs roughly one span of distance to fit the cloud; the offset below
    // lands about that far away while keeping a three-quarter view.
    const d = span * 0.55 + 0.4
    camera.position.set(cx + d, cy + d * 0.7 + 0.3, cz + d)
    camera.lookAt(cx, cy, cz)
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.set(cx, cy, cz)
      controls.update()
    }
    framed.current = true
    token.current = recenterToken
  })

  return null
}

export interface PartySceneProps {
  store: LiveStore
  paused: boolean
  showTrajectories?: boolean
  showFrustums?: boolean
  showGrid?: boolean
  pointSize?: number
  recenterToken?: number
}

export function PartyScene({
  store,
  paused,
  showTrajectories = true,
  showFrustums = true,
  showGrid = true,
  pointSize = 0.015,
  recenterToken = 0,
}: PartySceneProps): JSX.Element {
  return (
    <Canvas
      // Paused still lets the viewer orbit what is already on screen: "demand" renders on
      // interaction only, and LiveLayers stops uploading new data.
      frameloop={paused ? 'demand' : 'always'}
      dpr={[1, 2]}
      camera={{ position: [3, 2.4, 3], fov: 55, near: 0.02, far: 400 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#070a0f']} />
      <ambientLight intensity={1} />
      {showGrid ? (
        <>
          <gridHelper args={[20, 40, '#26364a', '#161f2b']} />
          <axesHelper args={[0.4]} />
        </>
      ) : null}
      <LiveLayers
        store={store}
        paused={paused}
        showTrajectories={showTrajectories}
        showFrustums={showFrustums}
        pointSize={pointSize}
      />
      <CameraRig store={store} recenterToken={recenterToken} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={200} minDistance={0.15} />
    </Canvas>
  )
}

/**
 * Memoized: the page re-renders a few times a second to refresh the counters, and none of
 * those renders should reconcile the canvas subtree.
 */
export default memo(PartyScene)
