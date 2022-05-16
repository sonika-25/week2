pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";
template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;
    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    var lastIndex = 2 * 2**n - 1;
    var hashes[lastIndex];
    component poseidons[2**n];

    // Initialize the hashes with input leaves
    for (var i = 0; i < 2**n; i++) {
        hashes[i] = leaves[i];
    }

    // Upper level parent hashes
    for (var i = 0; i < 2**n-1; i++) {
        poseidons[i] = Poseidon(2);
        poseidons[i].inputs[0] <-- hashes[2*i];
        poseidons[i].inputs[1] <-- hashes[2*i+1];
        hashes[2**n + i] = poseidons[i].out;
    }

    root <== hashes[2 * 2**n - 2];
    
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path

    component poseidons[n];
    component mux[n];

    signal hashesNum[n + 1];
    hashesNum[0] <== leaf;

    for (var i = 0; i < n; i++) {
        path_index[i] * (1 - path_index[i]) === 0;

        mux[i] = MultiMux1(2);

        mux[i].c[0][0] <== hashesNum[i];
        mux[i].c[0][1] <== path_elements[i];
        mux[i].c[1][0] <== path_elements[i];
        mux[i].c[1][1] <== hashesNum[i];

        mux[i].s <== path_index[i];

        poseidons[i] = Poseidon(2);

        poseidons[i].inputs[0] <== mux[i].out[0];
        poseidons[i].inputs[1] <== mux[i].out[1];

        hashesNum[i + 1] <== poseidons[i].out;
    }

    root <== hashesNum[n];
}