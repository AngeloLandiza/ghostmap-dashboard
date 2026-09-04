/**
 * The three.js point-cloud viewer used by `/maps/:id` (PLAN section 4).
 *
 * Rendering is a single `THREE.Points` over the typed arrays the loader produced — no
 * per-point objects, no re-allocation when the point size changes — with `OrbitControls`
 * for orbit/pan/zoom, a floor grid at the bottom of the bounding box, and a camera rig that
 * frames the cloud from its bounds and switches between the orbit and top-down views.
 *
 * Every three.js import lives in this file (and `usePlyCloud`), so the library only reaches
 * the browser inside the lazily loaded map-detail chunk.
 */
import { Component, useEffect, useMemo, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import type { PointCloudData } from './ply'

export type ViewMode = 'orbit' | 'top'

/** The bits of `OrbitControls` the rig touches; avoids depending on three-stdlib's types. */
interface ControlsLike {
  target: Vector3
  update: () => void
}

export interface PointCloudViewerProps {
  cloud: PointCloudData
  /** World-space point size (metres) — `sizeAttenuation` is on. */
  pointSize: number
  view: ViewMode
  showGrid: boolean
  /** Increment to re-frame the camera on the cloud. */
  frameSignal: number
}

/** Radius of the sphere that encloses the cloud, with a floor so degenerate maps still show. */
function boundsRadius(cloud: PointCloudData): number {
  const { min, max } = cloud.bbox
  return Math.max(0.5, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]))
}

/** A sensible default world point size for a cloud of this scale. */
export function suggestedPointSize(cloud: PointCloudData): number {
  return Math.min(0.2, Math.max(0.002, boundsRadius(cloud) / 500))
}

function CloudPoints({ cloud, pointSize }: { cloud: PointCloudData; pointSize: number }): JSX.Element {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(cloud.positions, 3))
    g.setAttribute('color', new BufferAttribute(cloud.colors, 3))
    const box = new Box3(new Vector3(...cloud.bbox.min), new Vector3(...cloud.bbox.max))
    g.boundingBox = box
    g.boundingSphere = box.getBoundingSphere(new Sphere())
    return g
  }, [cloud])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry}>
      <pointsMaterial vertexColors size={pointSize} sizeAttenuation toneMapped={false} />
    </points>
  )
}

/** Grid on the floor of the bounding box, sized to the map, plus the session origin axes. */
function FloorGrid({ cloud }: { cloud: PointCloudData }): JSX.Element {
  const { min, max } = cloud.bbox
  const spanX = max[0] - min[0]
  const spanZ = max[2] - min[2]
  const span = Math.max(2, spanX, spanZ)
  const size = Math.ceil(span * 1.6)
  const divisions = Math.max(4, Math.min(120, size))
  const center: [number, number, number] = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
  return (
    <group>
      <gridHelper
        args={[size, divisions, '#2c3d52', '#16202d']}
        position={center}
        material-transparent
        material-opacity={0.5}
        material-depthWrite={false}
      />
      <axesHelper args={[Math.max(0.25, span * 0.08)]} />
    </group>
  )
}

/** Frames the cloud: distance from the bounding sphere and the camera's effective field of view. */
function CameraRig({ cloud, view, frameSignal }: { cloud: PointCloudData; view: ViewMode; frameSignal: number }): null {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as ControlsLike | null
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)

  useEffect(() => {
    const { min, max } = cloud.bbox
    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const radius = boundsRadius(cloud)

    const perspective = camera as PerspectiveCamera
    const verticalFov = ((typeof perspective.fov === 'number' ? perspective.fov : 55) * Math.PI) / 180
    const aspect = width / Math.max(1, height)
    // On a phone the horizontal field of view is the tighter one; frame with whichever binds.
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    const fov = Math.max(0.2, Math.min(verticalFov, horizontalFov))
    const distance = (radius / Math.sin(fov / 2)) * 1.15

    const direction =
      view === 'top' ? new Vector3(0, 1, 0.0001).normalize() : new Vector3(1, 0.75, 1).normalize()
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0)
    camera.position.copy(center).addScaledVector(direction, distance)
    perspective.near = Math.max(0.01, distance / 2000)
    perspective.far = distance * 20 + radius * 20
    camera.lookAt(center)
    if (typeof perspective.updateProjectionMatrix === 'function') perspective.updateProjectionMatrix()

    if (controls) {
      controls.target.copy(center)
      controls.update()
    }
  }, [cloud, view, frameSignal, camera, controls, width, height])

  return null
}

/** Keeps a WebGL failure inside the viewer panel instead of blanking the route. */
class ViewerBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-400">
        The 3D viewer could not start in this browser.
        <br />
        <span className="text-xs text-ink-500">{this.state.message}</span>
      </div>
    )
  }
}

export function PointCloudViewer({
  cloud,
  pointSize,
  view,
  showGrid,
  frameSignal,
}: PointCloudViewerProps): JSX.Element {
  return (
    <ViewerBoundary>
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 55, near: 0.05, far: 2000, position: [4, 3, 4] }}
      >
        <color attach="background" args={['#070a0f']} />
        <CloudPoints cloud={cloud} pointSize={pointSize} />
        {showGrid ? <FloorGrid cloud={cloud} /> : null}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.12}
          zoomSpeed={0.9}
          panSpeed={0.8}
          rotateSpeed={0.85}
          screenSpacePanning
          maxDistance={5000}
        />
        <CameraRig cloud={cloud} view={view} frameSignal={frameSignal} />
      </Canvas>
    </ViewerBoundary>
  )
}

export default PointCloudViewer
