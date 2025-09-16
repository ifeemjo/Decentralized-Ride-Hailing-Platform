import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, stringAsciiCV, optionalCV, principalCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_PICKUP = 101;
const ERR_INVALID_DESTINATION = 102;
const ERR_INVALID_PRICE = 103;
const ERR_INVALID_STATUS = 104;
const ERR_RIDE_NOT_FOUND = 105;
const ERR_RIDE_ALREADY_ACCEPTED = 106;
const ERR_RIDE_NOT_PENDING = 107;
const ERR_RIDE_NOT_ACCEPTED = 108;
const ERR_RIDE_ALREADY_COMPLETED = 109;
const ERR_INVALID_TIMESTAMP = 110;
const ERR_AUTHORITY_NOT_VERIFIED = 111;
const ERR_INVALID_RIDER = 112;
const ERR_INVALID_DRIVER = 113;
const ERR_MAX_RIDES_EXCEEDED = 114;
const ERR_INVALID_UPDATE_PARAM = 115;
const ERR_RIDE_UPDATE_NOT_ALLOWED = 116;
const ERR_INVALID_LOCATION = 117;
const ERR_INVALID_CURRENCY = 118;
const ERR_INVALID_COMPLETION = 119;
const ERR_ESCROW_NOT_SET = 120;

interface Ride {
  rider: string;
  driver: string | null;
  pickup: string;
  destination: string;
  price: number;
  status: string;
  timestamp: number;
  currency: string;
  completionTime: number | null;
}

interface RideUpdate {
  updatePickup: string;
  updateDestination: string;
  updatePrice: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class RideRegistryMock {
  state: {
    rideCounter: number;
    maxRides: number;
    creationFee: number;
    authorityContract: string | null;
    rides: Map<number, Ride>;
    ridesByRider: Map<string, number[]>;
    ridesByDriver: Map<string, number[]>;
    rideUpdates: Map<number, RideUpdate>;
  } = {
    rideCounter: 0,
    maxRides: 10000,
    creationFee: 100,
    authorityContract: null,
    rides: new Map(),
    ridesByRider: new Map(),
    ridesByDriver: new Map(),
    rideUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1RIDER";
  authorities: Set<string> = new Set(["ST1RIDER"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  escrowCalls: Array<{ method: string; rideId: number; amount?: number; from?: string; to?: string }> = [];
  reputationCalls: Array<{ method: string; rideId: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      rideCounter: 0,
      maxRides: 10000,
      creationFee: 100,
      authorityContract: null,
      rides: new Map(),
      ridesByRider: new Map(),
      ridesByDriver: new Map(),
      rideUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1RIDER";
    this.authorities = new Set(["ST1RIDER"]);
    this.stxTransfers = [];
    this.escrowCalls = [];
    this.reputationCalls = [];
  }

  verifyUser(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  lockFunds(rideId: number, amount: number, from: string, to: string): Result<boolean> {
    this.escrowCalls.push({ method: "lock-funds", rideId, amount, from, to });
    return { ok: true, value: true };
  }

  releaseFunds(rideId: number, to: string): Result<boolean> {
    this.escrowCalls.push({ method: "release-funds", rideId, to });
    return { ok: true, value: true };
  }

  refundFunds(rideId: number, to: string): Result<boolean> {
    this.escrowCalls.push({ method: "refund-funds", rideId, to });
    return { ok: true, value: true };
  }

  updateRating(rideId: number, from: string, to: string): Result<boolean> {
    this.reputationCalls.push({ method: "update-rating", rideId, from, to });
    return { ok: true, value: true };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  registerRide(
    pickup: string,
    destination: string,
    price: number,
    currency: string
  ): Result<number> {
    if (this.state.rideCounter >= this.state.maxRides) return { ok: false, value: ERR_MAX_RIDES_EXCEEDED };
    if (!pickup || pickup.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!destination || destination.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (price <= 0) return { ok: false, value: ERR_INVALID_PRICE };
    if (!["STX", "USD"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (!this.verifyUser(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.rideCounter + 1;
    const ride: Ride = {
      rider: this.caller,
      driver: null,
      pickup,
      destination,
      price,
      status: "pending",
      timestamp: this.blockHeight,
      currency,
      completionTime: null,
    };
    this.state.rides.set(id, ride);
    const riderRides = this.state.ridesByRider.get(this.caller) || [];
    riderRides.push(id);
    this.state.ridesByRider.set(this.caller, riderRides);
    this.state.rideCounter = id;
    return { ok: true, value: id };
  }

  acceptRide(rideId: number): Result<boolean> {
    const ride = this.state.rides.get(rideId);
    if (!ride) return { ok: false, value: ERR_RIDE_NOT_FOUND };
    if (ride.status !== "pending") return { ok: false, value: ERR_RIDE_NOT_PENDING };
    if (ride.driver !== null) return { ok: false, value: ERR_RIDE_ALREADY_ACCEPTED };
    if (!this.verifyUser(this.caller).value) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (ride.rider === this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };

    const updated: Ride = { ...ride, driver: this.caller, status: "accepted" };
    this.state.rides.set(rideId, updated);
    const driverRides = this.state.ridesByDriver.get(this.caller) || [];
    driverRides.push(rideId);
    this.state.ridesByDriver.set(this.caller, driverRides);
    this.lockFunds(rideId, ride.price, ride.rider, this.caller);
    return { ok: true, value: true };
  }

  completeRide(rideId: number): Result<boolean> {
    const ride = this.state.rides.get(rideId);
    if (!ride) return { ok: false, value: ERR_RIDE_NOT_FOUND };
    if (ride.status !== "accepted") return { ok: false, value: ERR_RIDE_NOT_ACCEPTED };
    if (ride.rider !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (ride.driver === null) return { ok: false, value: ERR_INVALID_DRIVER };

    const updated: Ride = { ...ride, status: "completed", completionTime: this.blockHeight };
    this.state.rides.set(rideId, updated);
    this.releaseFunds(rideId, ride.driver);
    this.updateRating(rideId, this.caller, ride.driver);
    return { ok: true, value: true };
  }

  cancelRide(rideId: number): Result<boolean> {
    const ride = this.state.rides.get(rideId);
    if (!ride) return { ok: false, value: ERR_RIDE_NOT_FOUND };
    if (ride.status === "completed") return { ok: false, value: ERR_RIDE_ALREADY_COMPLETED };
    if (ride.rider !== this.caller && ride.driver !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };

    const updated: Ride = { ...ride, status: "cancelled", driver: null };
    this.state.rides.set(rideId, updated);
    if (ride.status === "accepted") {
      this.refundFunds(rideId, ride.rider);
    }
    return { ok: true, value: true };
  }

  updateRide(rideId: number, updatePickup: string, updateDestination: string, updatePrice: number): Result<boolean> {
    const ride = this.state.rides.get(rideId);
    if (!ride) return { ok: false, value: ERR_RIDE_NOT_FOUND };
    if (ride.rider !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (ride.status !== "pending") return { ok: false, value: ERR_RIDE_UPDATE_NOT_ALLOWED };
    if (!updatePickup || updatePickup.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!updateDestination || updateDestination.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (updatePrice <= 0) return { ok: false, value: ERR_INVALID_PRICE };

    const updated: Ride = {
      ...ride,
      pickup: updatePickup,
      destination: updateDestination,
      price: updatePrice,
      timestamp: this.blockHeight,
    };
    this.state.rides.set(rideId, updated);
    this.state.rideUpdates.set(rideId, {
      updatePickup,
      updateDestination,
      updatePrice,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getRide(rideId: number): Ride | null {
    return this.state.rides.get(rideId) || null;
  }

  getRideCount(): Result<number> {
    return { ok: true, value: this.state.rideCounter };
  }
}

describe("RideRegistry", () => {
  let contract: RideRegistryMock;

  beforeEach(() => {
    contract = new RideRegistryMock();
    contract.reset();
  });

  it("registers a ride successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.registerRide("PickupA", "DestB", 500, "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    const ride = contract.getRide(1);
    expect(ride?.pickup).toBe("PickupA");
    expect(ride?.destination).toBe("DestB");
    expect(ride?.price).toBe(500);
    expect(ride?.currency).toBe("STX");
    expect(ride?.status).toBe("pending");
    expect(contract.stxTransfers).toEqual([{ amount: 100, from: "ST1RIDER", to: "ST2AUTH" }]);
  });

  it("rejects registration without authority", () => {
    const result = contract.registerRide("PickupA", "DestB", 500, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid price", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.registerRide("PickupA", "DestB", 0, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PRICE);
  });

  it("accepts a ride successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.caller = "ST3DRIVER";
    contract.authorities.add("ST3DRIVER");
    const result = contract.acceptRide(1);
    expect(result.ok).toBe(true);
    const ride = contract.getRide(1);
    expect(ride?.driver).toBe("ST3DRIVER");
    expect(ride?.status).toBe("accepted");
    expect(contract.escrowCalls).toEqual([{ method: "lock-funds", rideId: 1, amount: 500, from: "ST1RIDER", to: "ST3DRIVER" }]);
  });

  it("completes a ride successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.caller = "ST3DRIVER";
    contract.authorities.add("ST3DRIVER");
    contract.acceptRide(1);
    contract.caller = "ST1RIDER";
    const result = contract.completeRide(1);
    expect(result.ok).toBe(true);
    const ride = contract.getRide(1);
    expect(ride?.status).toBe("completed");
    expect(contract.escrowCalls[1]).toEqual({ method: "release-funds", rideId: 1, to: "ST3DRIVER" });
    expect(contract.reputationCalls).toEqual([{ method: "update-rating", rideId: 1, from: "ST1RIDER", to: "ST3DRIVER" }]);
  });

  it("rejects complete if not accepted", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    const result = contract.completeRide(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RIDE_NOT_ACCEPTED);
  });

  it("cancels a ride successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.caller = "ST3DRIVER";
    contract.authorities.add("ST3DRIVER");
    contract.acceptRide(1);
    contract.caller = "ST1RIDER";
    const result = contract.cancelRide(1);
    expect(result.ok).toBe(true);
    const ride = contract.getRide(1);
    expect(ride?.status).toBe("cancelled");
    expect(ride?.driver).toBe(null);
    expect(contract.escrowCalls[1]).toEqual({ method: "refund-funds", rideId: 1, to: "ST1RIDER" });
  });

  it("rejects cancel if completed", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.caller = "ST3DRIVER";
    contract.authorities.add("ST3DRIVER");
    contract.acceptRide(1);
    contract.caller = "ST1RIDER";
    contract.completeRide(1);
    const result = contract.cancelRide(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RIDE_ALREADY_COMPLETED);
  });

  it("updates a ride successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    const result = contract.updateRide(1, "NewPickup", "NewDest", 600);
    expect(result.ok).toBe(true);
    const ride = contract.getRide(1);
    expect(ride?.pickup).toBe("NewPickup");
    expect(ride?.destination).toBe("NewDest");
    expect(ride?.price).toBe(600);
    const update = contract.state.rideUpdates.get(1);
    expect(update?.updatePickup).toBe("NewPickup");
    expect(update?.updateDestination).toBe("NewDest");
    expect(update?.updatePrice).toBe(600);
  });

  it("rejects update if not pending", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.caller = "ST3DRIVER";
    contract.authorities.add("ST3DRIVER");
    contract.acceptRide(1);
    contract.caller = "ST1RIDER";
    const result = contract.updateRide(1, "NewPickup", "NewDest", 600);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RIDE_UPDATE_NOT_ALLOWED);
  });

  it("returns correct ride count", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.registerRide("PickupA", "DestB", 500, "STX");
    contract.registerRide("PickupC", "DestD", 600, "USD");
    const result = contract.getRideCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setCreationFee(200);
    expect(result.ok).toBe(true);
    expect(contract.state.creationFee).toBe(200);
    contract.registerRide("PickupA", "DestB", 500, "STX");
    expect(contract.stxTransfers).toEqual([{ amount: 200, from: "ST1RIDER", to: "ST2AUTH" }]);
  });

  it("parses ride parameters with Clarity types", () => {
    const pickup = stringAsciiCV("PickupA");
    const price = uintCV(500);
    expect(pickup.value).toBe("PickupA");
    expect(price.value).toEqual(BigInt(500));
  });

  it("rejects registration with max rides exceeded", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.state.maxRides = 1;
    contract.registerRide("PickupA", "DestB", 500, "STX");
    const result = contract.registerRide("PickupC", "DestD", 600, "USD");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_RIDES_EXCEEDED);
  });
});