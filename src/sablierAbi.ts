// Generated from @sablier/lockup@4.0.1 artifacts/SablierLockup.json (only the functions Lifeguard uses).
export const sablierAbi = [
 {
  "type": "function",
  "name": "calculateMinFeeWei",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "minFeeWei",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "cancel",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "refundedAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "createWithDurationsLL",
  "inputs": [
   {
    "name": "params",
    "type": "tuple",
    "internalType": "struct Lockup.CreateWithDurations",
    "components": [
     {
      "name": "sender",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "recipient",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "depositAmount",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "token",
      "type": "address",
      "internalType": "contract IERC20"
     },
     {
      "name": "cancelable",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "transferable",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "shape",
      "type": "string",
      "internalType": "string"
     }
    ]
   },
   {
    "name": "unlockAmounts",
    "type": "tuple",
    "internalType": "struct LockupLinear.UnlockAmounts",
    "components": [
     {
      "name": "start",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "cliff",
      "type": "uint128",
      "internalType": "uint128"
     }
    ]
   },
   {
    "name": "granularity",
    "type": "uint40",
    "internalType": "uint40"
   },
   {
    "name": "durations",
    "type": "tuple",
    "internalType": "struct LockupLinear.Durations",
    "components": [
     {
      "name": "cliff",
      "type": "uint40",
      "internalType": "uint40"
     },
     {
      "name": "total",
      "type": "uint40",
      "internalType": "uint40"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "getCliffTime",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "cliffTime",
    "type": "uint40",
    "internalType": "uint40"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getDepositedAmount",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "depositedAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getEndTime",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "endTime",
    "type": "uint40",
    "internalType": "uint40"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getRecipient",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getSender",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "sender",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getUnderlyingToken",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "contract IERC20"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getWithdrawnAmount",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "withdrawnAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "isCancelable",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "result",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "refundableAmountOf",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "refundableAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "statusOf",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "status",
    "type": "uint8",
    "internalType": "enum Lockup.Status"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "withdrawMax",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "withdrawnAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "withdrawableAmountOf",
  "inputs": [
   {
    "name": "streamId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "withdrawableAmount",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 }
] as const;
