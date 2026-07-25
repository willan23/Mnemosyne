export type OwnerAckState = {
    activeDeviceIds: string[];
    pulledTombstonesByDevice: Map<string, Set<string>>;
};

export const tombstoneAckedByAllActiveDevices = (
    memoryId: string,
    deletedByDeviceId: unknown,
    ackState: OwnerAckState
): boolean => (
    ackState.activeDeviceIds.length === 0 ||
    ackState.activeDeviceIds.every((deviceId) => (
        deletedByDeviceId === deviceId ||
        Boolean(ackState.pulledTombstonesByDevice.get(deviceId)?.has(memoryId))
    ))
);
