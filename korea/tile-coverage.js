export function improveTileCoverage(scene, Cesium) {
  const { globe, fog, screenSpaceCameraController: cameraControls } = scene;
  globe.preloadSiblings = true;
  globe.preloadAncestors = true;
  globe.tileCacheSize = Math.max(globe.tileCacheSize, 240);
  globe.maximumScreenSpaceError = Math.min(globe.maximumScreenSpaceError, 1.5);

  if (fog && Number.isFinite(fog.density)) fog.density *= 0.65;
  cameraControls.minimumZoomDistance = Math.max(cameraControls.minimumZoomDistance, 8);
  cameraControls.enableCollisionDetection = true;

  const { RIGHT_DRAG, WHEEL, PINCH } = Cesium.CameraEventType;
  const tiltEvents = [cameraControls.tiltEventTypes].flat().filter(event => event != null);
  const zoomEvents = [cameraControls.zoomEventTypes].flat().filter(event => event != null);
  const isRightDrag = event => event === RIGHT_DRAG || event?.eventType === RIGHT_DRAG;
  // A drag can only drive one camera action. Plain right drag tilts, and the wheel zooms.
  cameraControls.zoomEventTypes = [...new Set([...zoomEvents.filter(event => !isRightDrag(event)), WHEEL, PINCH])];
  cameraControls.tiltEventTypes = [...new Set([...tiltEvents.filter(event => event !== RIGHT_DRAG), RIGHT_DRAG])];
  scene.canvas.addEventListener('contextmenu', event => event.preventDefault());

  function configurePrimitive(primitive) {
    if (Cesium.Cesium3DTileset && primitive instanceof Cesium.Cesium3DTileset) {
      primitive.maximumScreenSpaceError = Math.min(primitive.maximumScreenSpaceError, 12);
      primitive.foveatedScreenSpaceError = false;
      primitive.dynamicScreenSpaceError = false;
      primitive.loadSiblings = true;
      primitive.preloadFlightDestinations = true;
    } else if (Cesium.PrimitiveCollection && primitive instanceof Cesium.PrimitiveCollection) {
      watchCollection(primitive);
    }
  }

  const watched = new WeakSet();
  function watchCollection(collection) {
    if (watched.has(collection)) return;
    watched.add(collection);
    collection.primitiveAdded?.addEventListener(configurePrimitive);
    for (let index = 0; index < collection.length; index++) configurePrimitive(collection.get(index));
  }

  watchCollection(scene.primitives);
  scene.requestRender();
}
