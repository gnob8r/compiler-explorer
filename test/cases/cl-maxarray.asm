; Listing generated by Microsoft (R) Optimizing Compiler Version 19.00.23918.0 

include listing.inc

INCLUDELIB LIBCMT
INCLUDELIB OLDNAMES

PUBLIC	?maxArray@@YAXPEAN0@Z				; maxArray
EXTRN	_fltused:DWORD
; Function compile flags: /Ogtpy
; File c:\users\administrator\gcc-explorer-compiler1234\maxarray.cc
_TEXT	SEGMENT
x$ = 8
y$ = 16
?maxArray@@YAXPEAN0@Z PROC				; maxArray

; 2    :   for (int i = 0; i < 65536; i++)

  00000	48 8d 41 08	 lea	 rax, QWORD PTR [rcx+8]
  00004	48 2b d1	 sub	 rdx, rcx
  00007	b9 00 40 00 00	 mov	 ecx, 16384		; 00004000H
  0000c	0f 1f 40 00	 npad	 4
$LL9@maxArray:

; 3    :     if (y[i] > x[i]) x[i] = y[i];

  00010	f2 0f 10 44 02
	f8		 movsd	 xmm0, QWORD PTR [rdx+rax-8]
  00016	66 0f 2f 40 f8	 comisd	 xmm0, QWORD PTR [rax-8]
  0001b	76 05		 jbe	 SHORT $LN10@maxArray
  0001d	f2 0f 11 40 f8	 movsd	 QWORD PTR [rax-8], xmm0
$LN10@maxArray:
  00022	f2 0f 10 04 02	 movsd	 xmm0, QWORD PTR [rdx+rax]
  00027	66 0f 2f 00	 comisd	 xmm0, QWORD PTR [rax]
  0002b	76 04		 jbe	 SHORT $LN14@maxArray
  0002d	f2 0f 11 00	 movsd	 QWORD PTR [rax], xmm0
$LN14@maxArray:
  00031	f2 0f 10 44 02
	08		 movsd	 xmm0, QWORD PTR [rdx+rax+8]
  00037	66 0f 2f 40 08	 comisd	 xmm0, QWORD PTR [rax+8]
  0003c	76 05		 jbe	 SHORT $LN15@maxArray
  0003e	f2 0f 11 40 08	 movsd	 QWORD PTR [rax+8], xmm0
$LN15@maxArray:
  00043	f2 0f 10 44 02
	10		 movsd	 xmm0, QWORD PTR [rdx+rax+16]
  00049	66 0f 2f 40 10	 comisd	 xmm0, QWORD PTR [rax+16]
  0004e	76 05		 jbe	 SHORT $LN16@maxArray
  00050	f2 0f 11 40 10	 movsd	 QWORD PTR [rax+16], xmm0
$LN16@maxArray:
  00055	48 83 c0 20	 add	 rax, 32			; 00000020H

; 2    :   for (int i = 0; i < 65536; i++)

  00059	48 83 e9 01	 sub	 rcx, 1
  0005d	75 b1		 jne	 SHORT $LL9@maxArray

; 4    : }

  0005f	c3		 ret	 0
?maxArray@@YAXPEAN0@Z ENDP				; maxArray
_TEXT	ENDS
END
