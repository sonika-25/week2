// [assignment] please copy the entire modified custom.test.js here
// [assignment] please copy the entire modified custom.test.js here
const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  async function getBalance(tornadoPool, keypair) {
    const filter = tornadoPool.filters.NewCommitment()
    const blockUs = await ethers.provider.getBlock()
    const eventsFired = await tornadoPool.queryFilter(filter, blockUs.number)
    let rUtxo
    try {
        rUtxo = Utxo.decrypt(keypair, eventsFired[0].args.encryptedOutput, eventsFired[0].args.index)
    } catch (e) {
      rUtxo = Utxo.decrypt(keypair, eventsFired[1].args.encryptedOutput, eventsFired[1].args.index)
    }
    return rUtxo.amount
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const keypair = new Keypair() 

    const aliceDeposit = utils.parseEther('0.1')
    const aliceUtxoDepoit = new Utxo({ amount: aliceDeposit })

    const { args, extData } = await prepareTransaction({ tornadoPool, outputs: [aliceUtxoDepoit] })

    const onTokenBridgedData = encodeDataForBridge({ proof: args, extData })

    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceUtxoDepoit.amount,
      onTokenBridgedData,
    )
    await token.transfer(omniBridge.address, aliceDeposit)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDeposit)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, 
    ])

    const aliceWithdrawAmount = utils.parseEther('0.08')
    const recipient = '0xDeaD00000000000000000000000000000000BEEf'
    const aliceNewUtxo = new Utxo({ amount: aliceDeposit.sub(aliceWithdrawAmount), keypair })
    await transaction({
      tornadoPool,
      inputs: [aliceUtxoDepoit],
      outputs: [aliceNewUtxo],
      recipient,
      isL1Withdrawal: false,
    })

    const remainingBalance = await getBalance(tornadoPool, keypair)
    expect(remainingBalance).to.be.equal(aliceDeposit.sub(aliceWithdrawAmount))

    const recipientBalance = await token.balanceOf(recipient)
    expect(recipientBalance).to.be.equal(aliceWithdrawAmount)

    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(0)
  })

  it('[assignment] iii. deposit 0.13 ETH to L1 -> send 0.06 ETH to Bob -> withdraw from L1 and L2', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    const aliceKeypair = new Keypair() 

    const aliceDeposit = utils.parseEther('0.13')
    const aliceUtxoDepoit = new Utxo({ amount: aliceDeposit, keypair: aliceKeypair })
    await transaction({ tornadoPool, outputs: [aliceUtxoDepoit] })
    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(aliceDeposit)

    const bobKeypair = new Keypair() 
    const amountToBob = utils.parseEther('0.06')
    const bobUtxo = new Utxo({ amount: amountToBob, keypair: Keypair.fromString(bobKeypair.address()) })
    const aliceNewUtxo = new Utxo({ amount: aliceDeposit.sub(amountToBob), keypair: aliceKeypair })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      inputs: [aliceUtxoDepoit],
      outputs: [bobUtxo, aliceNewUtxo],
    })
    const onTokenBridgedData = encodeDataForBridge({ proof: args, extData })
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      amountToBob,
      onTokenBridgedData,
    )
    await token.transfer(omniBridge.address, amountToBob)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, amountToBob)
    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, 
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, 
    ])

    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(aliceDeposit.sub(amountToBob))
    expect(await getBalance(tornadoPool, bobKeypair)).to.be.equal(amountToBob)

    const aliceWithdrawAmount = aliceDeposit.sub(amountToBob)
    const aliceWithdrawUtxo = new Utxo({ amount: aliceWithdrawAmount, keypair: aliceKeypair })
    await transaction({
      tornadoPool,
      inputs: [aliceNewUtxo],
      outputs: [aliceWithdrawUtxo],
      isL1Withdrawal: true,
    })
    expect(await getBalance(tornadoPool, aliceKeypair)).to.be.equal(aliceWithdrawAmount)

    const bobWithdrawUtxo = new Utxo({ amount: amountToBob, keypair: bobKeypair })
    await transaction({
      tornadoPool,
      outputs: [bobWithdrawUtxo],
      isL1Withdrawal: false,
    })
    expect(await getBalance(tornadoPool, bobKeypair)).to.be.equal(amountToBob)

    const omniBridgeBalance = await token.balanceOf(omniBridge.address)
    expect(omniBridgeBalance).to.be.equal(0)
  })
})