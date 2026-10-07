import { computed, inject, Injectable } from '@angular/core';
import { RolePermissionService } from '@axe/application/permission/role-permission.service';
import { ObjectChangeService } from '@axe/application/sync/object-change.service';
import { ObjectStore } from '@axe/core/sync/object-store';
import { Jukebox } from '@axe/domain/media/jukebox';
import { Config } from '@axe/domain/peer/config';

/**
 * The room volume, which every listener's own volumes are multiplied by. It is shared with the
 * room, and only the game master may change it, as with the room's other shared settings.
 */
@Injectable({ providedIn: 'root' })
export class RoomVolumeService {
  private readonly objectStore = inject(ObjectStore);
  private readonly objectChange = inject(ObjectChangeService);
  private readonly rolePermission = inject(RolePermissionService);

  /** The room volume, from 0 to 2; 1 before the room's settings exist. */
  readonly volume = computed(() => {
    this.objectChange.versionOf('Config')();
    return this.objectStore.get<Config>('Config')?.roomVolume ?? 1;
  });

  /** Whether this reader may change the room volume, which only the game master may. */
  readonly canChange = computed(() => {
    this.objectChange.trackMyCursor();
    return this.rolePermission.canEditShared;
  });

  /** Sets the room volume for everyone and makes it heard here at once. Anyone but the game master is refused. */
  set(volume: number): void {
    if (!this.rolePermission.canEditShared) return;
    const config = this.objectStore.get<Config>('Config');
    if (config) config.roomVolume = volume;
    this.objectStore.get<Jukebox>('Jukebox')?.setNewVolume();
  }
}
