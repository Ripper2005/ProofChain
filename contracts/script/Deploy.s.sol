// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ProductRegistry} from "../src/ProductRegistry.sol";

/// @notice Deploys ProductRegistry and grants the manufacturer and recall roles.
/// @dev PRIVATE_KEY must be the key for ADMIN_ADDRESS. The script reverts otherwise.
contract Deploy is Script {
    error AdminKeyMismatch(address signer, address admin);

    function run() external returns (ProductRegistry registry) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address manufacturer = vm.envAddress("MANUFACTURER_ADDRESS");
        address recaller = vm.envAddress("RECALLER_ADDRESS");

        address signer = vm.addr(privateKey);
        if (signer != admin) revert AdminKeyMismatch(signer, admin);

        vm.startBroadcast(privateKey);
        registry = new ProductRegistry(admin);
        registry.grantRole(registry.MANUFACTURER_ROLE(), manufacturer);
        registry.grantRole(registry.RECALL_ROLE(), recaller);
        vm.stopBroadcast();

        console2.log("ProductRegistry", address(registry));
    }
}
