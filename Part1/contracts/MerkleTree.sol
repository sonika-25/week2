//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root
    uint16 private levels;
    uint16 private leaves;

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        levels = 3; 
        leaves = 8; 

        hashes = new uint256[](2 * leaves - 1);
        for (uint i = 0; i < leaves; i++) {
            hashes[i] = 0;
        }

         for (uint i = 0; i < leaves - 1; i++) {
            hashes[leaves + i] = PoseidonT3.poseidon([hashes[2*i], hashes[2*i+1]]);
        }

        root = hashes[hashes.length - 1];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        hashes[index] = hashedLeaf;

        uint first = 0;
        uint offset = index;

        for (uint i = 1; i < leaves; i *= 2) {
            uint current = first + offset;
            first += leaves / i;
            offset /= 2;
            hashes[first + offset] = current % 2 == 0 ? PoseidonT3.poseidon([hashes[current], hashes[current + 1]]): PoseidonT3.poseidon([hashes[current - 1], hashes[current]]);
        }

        ++index;
        root = hashes[hashes.length - 1];
        return root;
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return verifyProof(a, b, c, input);

    }
}
